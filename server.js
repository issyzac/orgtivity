const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');

// Load environment variables
dotenv.config();

// Catch global unhandled promise rejections and uncaught exceptions to prevent crashes on Railway
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception thrown:', err);
});

const dbManager = require('./db-manager');
const slackHandlers = require('./slack-handlers');

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve Slack User ID by email or name, caching it to the DB if found
async function getSlackUserId(client, userObj) {
  if (userObj.slackUserId) return userObj.slackUserId;

  // 1. Try to find by email
  if (userObj.email) {
    try {
      const res = await client.users.lookupByEmail({ email: userObj.email });
      if (res.ok && res.user) {
        userObj.slackUserId = res.user.id;
        dbManager.saveUser(userObj);
        console.log(`Resolved and cached Slack User ID ${res.user.id} for email ${userObj.email}`);
        return res.user.id;
      }
    } catch (e) {
      console.warn(`Slack lookupByEmail failed for ${userObj.email}:`, e.message);
    }
  }

  // 2. Fallback to name search in user directory
  try {
    const res = await client.users.list();
    if (res.ok && res.members) {
      const member = res.members.find(m => 
        m.real_name?.toLowerCase() === userObj.name.toLowerCase() ||
        m.name?.toLowerCase() === userObj.name.toLowerCase()
      );
      if (member) {
        userObj.slackUserId = member.id;
        dbManager.saveUser(userObj);
        console.log(`Resolved and cached Slack User ID ${member.id} for name ${userObj.name}`);
        return member.id;
      }
    }
  } catch (e) {
    console.warn(`Slack users.list failed for name lookup of ${userObj.name}:`, e.message);
  }

  return null;
}

// Resolve channel ID by name, supporting env-var override
async function getChannelId(client, defaultName, envVarValue) {
  if (envVarValue) return envVarValue;
  try {
    const cleanName = defaultName.replace('#', '').trim();
    const res = await client.conversations.list({
      exclude_archived: true,
      types: 'public_channel,private_channel'
    });
    if (res.ok && res.channels) {
      const chan = res.channels.find(c => c.name === cleanName);
      if (chan) return chan.id;
    }
  } catch (e) {
    console.warn(`Failed to resolve channel ${defaultName}:`, e.message);
  }
  return defaultName;
}

// Check if credentials are placeholder values
const isPlaceholder = (str) => {
  if (!str) return true;
  const s = str.toLowerCase();
  return s.includes('your-') || s.includes('placeholder') || s.trim() === '';
};

// 1. REAL SLACK INTEGRATION SETUP (if credentials are provided)
let boltApp = null;
let receiver = null;

if (
  process.env.SLACK_BOT_TOKEN && 
  process.env.SLACK_SIGNING_SECRET &&
  !isPlaceholder(process.env.SLACK_BOT_TOKEN) &&
  !isPlaceholder(process.env.SLACK_SIGNING_SECRET)
) {
  try {
    const { App, ExpressReceiver } = require('@slack/bolt');
    receiver = new ExpressReceiver({
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      endpoints: '/slack/events'
    });

    boltApp = new App({
      token: process.env.SLACK_BOT_TOKEN,
      receiver: receiver
    });

    // Mount Bolt receiver router BEFORE standard express body parsers
    app.use(receiver.router);
    console.log("⚡️ Real Slack Bolt app receiver mounted at /slack/events");

    // Command: /lrf or /orgtivity-lrf
    boltApp.command(/lrf|orgtivity-lrf/, async ({ command, ack, client }) => {
      await ack();
      try {
        const projects = dbManager.getProjects();
        const users = dbManager.getUsers();
        const rawModal = slackHandlers.buildLrfModal(projects, users);
        const slackModal = slackHandlers.translateModalToSlack(rawModal);

        await client.views.open({
          trigger_id: command.trigger_id,
          view: slackModal
        });
      } catch (err) {
        console.error("Slack command /lrf error:", err);
      }
    });

    // Command: /rates
    boltApp.command('/rates', async ({ command, ack, respond }) => {
      await ack();
      try {
        const rates = dbManager.getRates();
        let text = "*Current Standard Rates per Location:*\n";
        rates.forEach(r => {
          text += `• *${r.location}*: Per Diem = ${r.perDiem.toLocaleString()} TZS, Hotel = ${r.hotel.toLocaleString()} TZS, Taxi = ${r.taxi.toLocaleString()} TZS\n`;
        });
        await respond({
          text: text,
          response_type: 'ephemeral'
        });
      } catch (err) {
        console.error("Slack command /rates error:", err);
      }
    });

    // View submit: LRF Submission
    boltApp.view('lrf_modal_submit', async ({ ack, body, view, client }) => {
      await ack();
      try {
        const slackValues = view.state.values;
        const values = slackHandlers.translateSlackSubmissionToSimulator(slackValues);
        const activity = slackHandlers.handleLrfSubmission(values);
        
        const usersList = dbManager.getUsers();
        const supervisor = activity.supervisorId
          ? usersList.find(u => u.id === activity.supervisorId)
          : null;
        const generalChan = await getChannelId(client, '#general', process.env.SLACK_CHANNEL_GENERAL);

        await client.chat.postMessage({
          channel: generalChan,
          text: `📢 *New Travel Request Filed:* *${activity.purpose}* for *${activity.travelerName}* (${activity.destination}). Awaiting sign-off by ${supervisor ? supervisor.name : 'their supervisor'}.`
        });

        // Ask the supervisor to sign off the LRF before anything else proceeds.
        const signOffBlocks = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📝 *LRF Sign-Off Needed:* *${activity.travelerName}* filed a Travel Request that needs your approval before it can proceed.`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Purpose:* ${activity.purpose}\n*Route:* ${activity.origin} → ${activity.destination}\n*Dates:* ${activity.dates}\n*Advance Needed:* ${activity.advanceRequired ? 'Yes' : 'No'}`
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Sign & Approve' },
                action_id: 'open_lrf_sign_modal',
                value: activity.id,
                style: 'primary'
              }
            ]
          }
        ];

        const approvalChan = await getChannelId(client, '#lrf-approvals', process.env.SLACK_CHANNEL_APPROVALS);
        await client.chat.postMessage({
          channel: approvalChan,
          text: `📝 LRF sign-off needed for *${activity.travelerName}* — ${activity.purpose}.`,
          blocks: signOffBlocks
        });

        if (supervisor) {
          const supervisorSlackId = await getSlackUserId(client, supervisor);
          if (supervisorSlackId) {
            await client.chat.postMessage({
              channel: supervisorSlackId,
              text: `📝 LRF sign-off needed for *${activity.travelerName}* — ${activity.purpose}.`,
              blocks: signOffBlocks
            });
          }
        }
      } catch (err) {
        console.error("Slack LRF submit error:", err);
      }
    });

    // Action click: open the LRF sign-off modal (manager types signature)
    boltApp.action('open_lrf_sign_modal', async ({ ack, body, client }) => {
      await ack();
      try {
        const activityId = body.actions[0].value;
        const activity = dbManager.getActivity(activityId);
        if (!activity) return;

        const rawModal = slackHandlers.buildLrfSignModal(activityId);
        const slackModal = slackHandlers.translateModalToSlack(rawModal);
        await client.views.open({
          trigger_id: body.trigger_id,
          view: slackModal
        });
      } catch (err) {
        console.error("Slack Action open_lrf_sign_modal error:", err);
      }
    });

    // View submit: LRF sign-off (typed signature) -> notify traveler to proceed
    boltApp.view('lrf_sign_modal_submit', async ({ ack, body, view, client }) => {
      await ack();
      try {
        const activityId = view.private_metadata;
        const slackValues = view.state.values;
        const values = slackHandlers.translateSlackSubmissionToSimulator(slackValues);

        // Identify the signing manager from their Slack identity.
        const slackUserId = body.user.id;
        const usersList = dbManager.getUsers();
        let signer = usersList.find(u => u.slackUserId === slackUserId);
        if (!signer) {
          try {
            const info = await client.users.info({ user: slackUserId });
            if (info.ok && info.user) {
              const realName = info.user.real_name || info.user.name;
              signer = usersList.find(u => u.name.toLowerCase() === realName.toLowerCase());
              if (signer) { signer.slackUserId = slackUserId; dbManager.saveUser(signer); }
            }
          } catch (e) {
            console.warn("Failed to resolve LRF signer:", e.message);
          }
        }

        const activity = slackHandlers.handleLrfSignSubmission(activityId, values, {
          approverId: signer ? signer.id : undefined,
          approverName: signer ? signer.name : undefined,
          approverTitle: signer ? signer.title : undefined
        });

        const approverName = activity.lrfApproval.approvedBy;

        // Notify the traveler that the LRF is approved and what to do next.
        const traveler = usersList.find(u => u.id === activity.travelerId);
        if (traveler) {
          const travelerSlackId = await getSlackUserId(client, traveler);
          if (travelerSlackId) {
            if (activity.advanceRequired) {
              await client.chat.postMessage({
                channel: travelerSlackId,
                text: `✅ Your Travel Request *${activity.purpose}* was signed off by ${approverName}. Please complete your Advance Request form.`,
                blocks: [
                  { type: 'section', text: { type: 'mrkdwn', text: `✅ Your Travel Request *${activity.purpose}* was signed off by *${approverName}*. Since it requires an advance, please complete your Advance Request form.` } },
                  { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Complete Advance Form' }, action_id: 'open_advance_form', value: activity.id, style: 'primary' }] }
                ]
              });
            } else {
              await client.chat.postMessage({
                channel: travelerSlackId,
                text: `✅ Your Travel Request *${activity.purpose}* was signed off by ${approverName}. No advance was requested — please retire expenses with receipts after the trip.`,
                blocks: [
                  { type: 'section', text: { type: 'mrkdwn', text: `✅ Your Travel Request *${activity.purpose}* was signed off by *${approverName}*. No advance was requested — please retire your expenses with receipts after the trip.` } },
                  { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Retire Expenses (Refund)' }, action_id: 'open_retirement_form', value: activity.id, style: 'primary' }] }
                ]
              });
            }
          }
        }
      } catch (err) {
        console.error("Slack LRF sign submit error:", err);
      }
    });

    // Action click: Complete Advance Form
    boltApp.action('open_advance_form', async ({ ack, body, client }) => {
      await ack();
      try {
        const activityId = body.actions[0].value;
        const activity = dbManager.getActivity(activityId);
        if (!activity) return;

        const rates = dbManager.getRates();
        const rawModal = slackHandlers.buildAdvanceModal(activityId, activity.travelerName, rates, activity.destination);
        const slackModal = slackHandlers.translateModalToSlack(rawModal);

        await client.views.open({
          trigger_id: body.trigger_id,
          view: slackModal
        });
      } catch (err) {
        console.error("Slack Action open_advance_form error:", err);
      }
    });

    // View submit: Advance Form Submission
    boltApp.view('advance_modal_submit', async ({ ack, body, view, client }) => {
      await ack();
      try {
        const activityId = view.private_metadata;
        const slackValues = view.state.values;
        const values = slackHandlers.translateSlackSubmissionToSimulator(slackValues);
        const activity = slackHandlers.handleAdvanceSubmission(activityId, values);

        const traveler = dbManager.getUsers().find(u => u.id === activity.travelerId);
        let supervisor = null;
        if (traveler && traveler.supervisorId) {
          supervisor = dbManager.getUsers().find(u => u.id === traveler.supervisorId);
        }

        const approvalChan = await getChannelId(client, '#lrf-approvals', process.env.SLACK_CHANNEL_APPROVALS);
        const itemsList = activity.advance.items.map(item => 
          `• *${item.description}*:\n  ${item.unitCost.toLocaleString()} x ${item.units} x ${item.frequency} = *${item.total.toLocaleString()} TZS*`
        ).join('\n');

        const messagePayload = {
          text: `📥 *Advance Approval Request:* *${activity.travelerName}* requested an advance of *TZS ${activity.advance.totalRequested.toLocaleString()}* for *${activity.purpose}*.`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `📥 *Advance Approval Request:* *${activity.travelerName}* requested an advance of *TZS ${activity.advance.totalRequested.toLocaleString()}* for *${activity.purpose}*.`
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Employee:* ${activity.travelerName} (${activity.travelerTitle})\n*Activity:* ${activity.purpose}\n*Budget:* TZS ${activity.advance.totalRequested.toLocaleString()}\n\n*Line Items Requested:*\n${itemsList}`
              }
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Approve Advance' },
                  action_id: 'approve_advance',
                  value: activity.id,
                  style: 'primary'
                },
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Reject Advance' },
                  action_id: 'reject_advance',
                  value: activity.id,
                  style: 'danger'
                }
              ]
            }
          ]
        };

        await client.chat.postMessage({
          channel: approvalChan,
          ...messagePayload
        });

        if (supervisor) {
          const supervisorSlackId = await getSlackUserId(client, supervisor);
          if (supervisorSlackId) {
            await client.chat.postMessage({
              channel: supervisorSlackId,
              ...messagePayload
            });
          }
        }
      } catch (err) {
        console.error("Slack Advance submit error:", err);
      }
    });

    // Action click: Approve / Reject Advance
    const handleAdvanceApprovalAction = async (approved, { ack, body, client }) => {
      await ack();
      try {
        const activityId = body.actions[0].value;
        const slackUserId = body.user.id;
        
        const usersList = dbManager.getUsers();
        let dbSupervisor = usersList.find(u => u.slackUserId === slackUserId);
        if (!dbSupervisor) {
          try {
            const userInfo = await client.users.info({ user: slackUserId });
            if (userInfo.ok && userInfo.user) {
              const realName = userInfo.user.real_name || userInfo.user.name;
              dbSupervisor = usersList.find(u => u.name.toLowerCase() === realName.toLowerCase());
              if (dbSupervisor) {
                dbSupervisor.slackUserId = slackUserId;
                dbManager.saveUser(dbSupervisor);
              }
            }
          } catch (e) {
            console.warn("Failed to find supervisor user info:", e.message);
          }
        }

        const supervisorId = dbSupervisor ? dbSupervisor.id : 'usr-director';
        const updatedActivity = slackHandlers.handleAdvanceApproval(activityId, supervisorId, approved);
        
        const originalText = body.message.text;
        const supervisorName = dbSupervisor ? dbSupervisor.name : 'Supervisor';
        const decisionText = approved 
          ? `✅ *Approved* by ${supervisorName}` 
          : `❌ *Rejected* by ${supervisorName}`;

        const updatedBlocks = body.message.blocks.filter(b => b.type !== 'actions');
        updatedBlocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `${decisionText} on ${new Date().toLocaleDateString()}`
            }
          ]
        });

        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          text: originalText,
          blocks: updatedBlocks
        });

        const traveler = usersList.find(u => u.id === updatedActivity.travelerId);
        if (traveler) {
          const travelerSlackId = await getSlackUserId(client, traveler);
          if (travelerSlackId) {
            if (approved) {
              await client.chat.postMessage({
                channel: travelerSlackId,
                text: `✅ Your Advance request of *TZS ${updatedActivity.advance.totalRequested.toLocaleString()}* for *${updatedActivity.purpose}* has been *APPROVED* by ${supervisorName}. Funds are being disbursed.\nOnce the trip is done, click below to retire your expenses.`,
                blocks: [
                  {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: `✅ Your Advance request of *TZS ${updatedActivity.advance.totalRequested.toLocaleString()}* for *${updatedActivity.purpose}* has been *APPROVED* by ${supervisorName}. Funds are being disbursed.\nOnce the trip is done, click below to retire your expenses.`
                    }
                  },
                  {
                    type: 'actions',
                    elements: [
                      {
                        type: 'button',
                        text: { type: 'plain_text', text: 'Retire Expenses' },
                        action_id: 'open_retirement_form',
                        value: updatedActivity.id,
                        style: 'primary'
                      }
                    ]
                  }
                ]
              });

              const financeChan = await getChannelId(client, '#finance', process.env.SLACK_CHANNEL_FINANCE);
              await client.chat.postMessage({
                channel: financeChan,
                text: `💸 *Disbursement Authorized:* Please pay *TZS ${updatedActivity.advance.totalRequested.toLocaleString()}* to *${updatedActivity.travelerName}* for activity *${updatedActivity.purpose}*.\nFunder Allocation: _${updatedActivity.funder}_`
              });
            } else {
              await client.chat.postMessage({
                channel: travelerSlackId,
                text: `❌ Your Advance request for *${updatedActivity.purpose}* has been *REJECTED* by ${supervisorName}.`
              });
            }
          }
        }
      } catch (err) {
        console.error("Slack approve/reject advance error:", err);
      }
    };

    boltApp.action('approve_advance', async (args) => handleAdvanceApprovalAction(true, args));
    boltApp.action('reject_advance', async (args) => handleAdvanceApprovalAction(false, args));

    // Action click: Retire Expenses
    boltApp.action('open_retirement_form', async ({ ack, body, client }) => {
      await ack();
      try {
        const activityId = body.actions[0].value;
        const activity = dbManager.getActivity(activityId);
        if (!activity) return;

        const expenseCats = dbManager.getExpenseCategories();
        const advanceAmount = activity.advance ? activity.advance.totalRequested : 0;
        const rawModal = slackHandlers.buildRetirementModal(activityId, advanceAmount, expenseCats, activity.purpose);
        const slackModal = slackHandlers.translateModalToSlack(rawModal);

        await client.views.open({
          trigger_id: body.trigger_id,
          view: slackModal
        });
      } catch (err) {
        console.error("Slack Action open_retirement_form error:", err);
      }
    });

    // View submit: Retirement Form Submission
    boltApp.view('retirement_modal_submit', async ({ ack, body, view, client }) => {
      await ack();
      try {
        const activityId = view.private_metadata;
        const slackValues = view.state.values;
        const values = slackHandlers.translateSlackSubmissionToSimulator(slackValues);
        const activity = slackHandlers.handleRetirementSubmission(activityId, values);

        const traveler = dbManager.getUsers().find(u => u.id === activity.travelerId);
        let supervisor = null;
        if (traveler && traveler.supervisorId) {
          supervisor = dbManager.getUsers().find(u => u.id === traveler.supervisorId);
        }

        const approvalChan = await getChannelId(client, '#lrf-approvals', process.env.SLACK_CHANNEL_APPROVALS);
        const isRefund = activity.retirement.netDue > 0;
        const absNet = Math.abs(activity.retirement.netDue);
        const flowText = isRefund 
          ? `*Refund Due to Employee:* TZS ${absNet.toLocaleString()}` 
          : `*Payback Due to D-tree:* TZS ${absNet.toLocaleString()}`;

        const expensesList = activity.retirement.expenses.map(exp => 
          `• *[${exp.category}]* ${exp.memo}:\n  ${exp.unitCost.toLocaleString()} x ${exp.units} x ${exp.frequency} = *${exp.total.toLocaleString()} TZS*`
        ).join('\n');

        const messagePayload = {
          text: `📥 *Retirement Approval Request:* *${activity.travelerName}* submitted expenses for *${activity.purpose}*.`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `📥 *Retirement Approval Request:* *${activity.travelerName}* submitted expenses for *${activity.purpose}*.`
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Activity:* ${activity.purpose}\n*Advance Paid:* TZS ${activity.retirement.advanceAmount.toLocaleString()}\n*Actual Expenses:* TZS ${activity.retirement.subtotal.toLocaleString()}\n\n${flowText}\n*Receipts:* \`${activity.retirement.receipts.join(', ')}\`\n\n*Expenses Detail:*\n${expensesList}`
              }
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Approve Retirement' },
                  action_id: 'approve_retirement',
                  value: activity.id,
                  style: 'primary'
                },
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Reject Retirement' },
                  action_id: 'reject_retirement',
                  value: activity.id,
                  style: 'danger'
                }
              ]
            }
          ]
        };

        await client.chat.postMessage({
          channel: approvalChan,
          ...messagePayload
        });

        if (supervisor) {
          const supervisorSlackId = await getSlackUserId(client, supervisor);
          if (supervisorSlackId) {
            await client.chat.postMessage({
              channel: supervisorSlackId,
              ...messagePayload
            });
          }
        }
      } catch (err) {
        console.error("Slack Retirement submit error:", err);
      }
    });

    // Action click: Approve / Reject Retirement
    const handleRetirementApprovalAction = async (approved, { ack, body, client }) => {
      await ack();
      try {
        const activityId = body.actions[0].value;
        const slackUserId = body.user.id;

        const usersList = dbManager.getUsers();
        let dbSupervisor = usersList.find(u => u.slackUserId === slackUserId);
        if (!dbSupervisor) {
          try {
            const userInfo = await client.users.info({ user: slackUserId });
            if (userInfo.ok && userInfo.user) {
              const realName = userInfo.user.real_name || userInfo.user.name;
              dbSupervisor = usersList.find(u => u.name.toLowerCase() === realName.toLowerCase());
              if (dbSupervisor) {
                dbSupervisor.slackUserId = slackUserId;
                dbManager.saveUser(dbSupervisor);
              }
            }
          } catch (e) {
            console.warn("Failed to find supervisor user info:", e.message);
          }
        }

        const supervisorId = dbSupervisor ? dbSupervisor.id : 'usr-director';
        const updatedActivity = slackHandlers.handleRetirementApproval(activityId, supervisorId, approved);

        const originalText = body.message.text;
        const supervisorName = dbSupervisor ? dbSupervisor.name : 'Supervisor';
        const decisionText = approved 
          ? `✅ *Approved* by ${supervisorName}` 
          : `❌ *Rejected* by ${supervisorName}`;

        const updatedBlocks = body.message.blocks.filter(b => b.type !== 'actions');
        updatedBlocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `${decisionText} on ${new Date().toLocaleDateString()}`
            }
          ]
        });

        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          text: originalText,
          blocks: updatedBlocks
        });

        const traveler = usersList.find(u => u.id === updatedActivity.travelerId);
        if (traveler) {
          const travelerSlackId = await getSlackUserId(client, traveler);
          if (travelerSlackId) {
            const absNet = Math.abs(updatedActivity.retirement.netDue);
            const isRefund = updatedActivity.retirement.netDue > 0;
            
            if (approved) {
              let dmText = '';
              let finText = '';
              const financeChan = await getChannelId(client, '#finance', process.env.SLACK_CHANNEL_FINANCE);

              if (isRefund) {
                dmText = `✅ Your Retirement for *${updatedActivity.purpose}* is *APPROVED* by ${supervisorName}.\nRefund payment of *TZS ${absNet.toLocaleString()}* has been forwarded to finance.`;
                finText = `💸 *Refund Authorized:* Please refund *TZS ${absNet.toLocaleString()}* to *${updatedActivity.travelerName}* for retired activity *${updatedActivity.purpose}*.\nApproved Expenses: TZS ${updatedActivity.retirement.subtotal.toLocaleString()} vs Advance: TZS ${updatedActivity.retirement.advanceAmount.toLocaleString()}`;
              } else {
                dmText = `✅ Your Retirement for *${updatedActivity.purpose}* is *APPROVED* by ${supervisorName}.\nYou had an outstanding balance of *TZS ${absNet.toLocaleString()}* which must be repaid to D-tree office. Finance has been notified.`;
                finText = `📥 *Repayment Pending:* Traveler *${updatedActivity.travelerName}* owes D-tree *TZS ${absNet.toLocaleString()}* for retired activity *${updatedActivity.purpose}*.\nApproved Expenses: TZS ${updatedActivity.retirement.subtotal.toLocaleString()} vs Advance: TZS ${updatedActivity.retirement.advanceAmount.toLocaleString()}`;
              }

              await client.chat.postMessage({
                channel: travelerSlackId,
                text: dmText
              });

              await client.chat.postMessage({
                channel: financeChan,
                text: finText
              });
            } else {
              await client.chat.postMessage({
                channel: travelerSlackId,
                text: `❌ Your Retirement for *${updatedActivity.purpose}* has been *REJECTED* by ${supervisorName}. Please review your expenses and resubmit.`
              });
            }
          }
        }
      } catch (err) {
        console.error("Slack approve/reject retirement error:", err);
      }
    };

    boltApp.action('approve_retirement', async (args) => handleRetirementApprovalAction(true, args));
    boltApp.action('reject_retirement', async (args) => handleRetirementApprovalAction(false, args));

  } catch (e) {
    console.warn("⚠️ Failed to initialize Bolt app:", e.message);
  }
}

// 2. CORE MIDDLEWARE
// NOTE: these are mounted AFTER the Bolt ExpressReceiver router above so that
// Slack request signature verification still sees the raw request body.
app.use(cors());
app.use(express.json({ limit: '10mb' })); // large limit for base64 signature images
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Persisted signature images live in data/signatures and are served statically.
const SIGNATURES_DIR = path.join(__dirname, 'data', 'signatures');
if (!fs.existsSync(SIGNATURES_DIR)) {
  fs.mkdirSync(SIGNATURES_DIR, { recursive: true });
}
app.use('/signatures', express.static(SIGNATURES_DIR));

// Serve the web dashboard / registry front-end.
app.use(express.static(path.join(__dirname, 'public')));

// 3. SIMULATOR & WORKSPACE APIS

// Get core metadata
app.get('/api/projects', (req, res) => res.json(dbManager.getProjects()));
app.get('/api/users', (req, res) => res.json(dbManager.getUsers()));
app.get('/api/rates', (req, res) => res.json(dbManager.getRates()));
app.get('/api/expense-categories', (req, res) => res.json(dbManager.getExpenseCategories()));

// Activities CRUD
app.get('/api/activities', (req, res) => {
  res.json(dbManager.getActivities());
});

app.get('/api/activities/:id', (req, res) => {
  const act = dbManager.getActivity(req.params.id);
  if (!act) return res.status(404).json({ error: "Activity not found" });
  res.json(act);
});

app.delete('/api/activities/:id', (req, res) => {
  dbManager.deleteActivity(req.params.id);
  res.json({ success: true });
});

// Web Dashboard LRF sign-off. Accepts either a drawn signature (base64 PNG
// data URL) or typed signature text, records the supervisor approval, and
// advances the activity to its next status.
app.post('/api/activities/:id/approve-lrf', (req, res) => {
  try {
    const activityId = req.params.id;
    const activity = dbManager.getActivity(activityId);
    if (!activity) return res.status(404).json({ error: "Activity not found" });
    if (activity.status !== 'Awaiting LRF Approval') {
      return res.status(400).json({ error: `Activity is not awaiting LRF approval (current status: ${activity.status}).` });
    }

    const { signatureImage, signatureText, approverId } = req.body || {};
    const opts = { approverId };

    if (signatureImage && /^data:image\/png;base64,/.test(signatureImage)) {
      // Persist the drawn signature as a PNG file and store only its path.
      const base64 = signatureImage.replace(/^data:image\/png;base64,/, '');
      const fileName = `${activityId}-${Date.now()}.png`;
      fs.writeFileSync(path.join(SIGNATURES_DIR, fileName), Buffer.from(base64, 'base64'));
      opts.signatureType = 'drawn';
      opts.signatureImage = `/signatures/${fileName}`;
    } else if (signatureText && signatureText.trim()) {
      opts.signatureType = 'typed';
      opts.signatureText = signatureText.trim();
    } else {
      return res.status(400).json({ error: "A drawn or typed signature is required." });
    }

    const updated = slackHandlers.approveLrf(activityId, opts);
    res.json({ success: true, activity: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create manual LRF
app.post('/api/activities', (req, res) => {
  const projects = dbManager.getProjects();
  const users = dbManager.getUsers();
  
  const projectId = req.body.projectId || projects[0].id;
  const travelerId = req.body.travelerId || users[0].id;
  const project = projects.find(p => p.id === projectId);
  const traveler = users.find(u => u.id === travelerId);

  const act = {
    id: `act-${uuidv4().substring(0, 8)}`,
    purpose: req.body.purpose || "Zanzibar SMT Meeting",
    projectId,
    projectName: project ? project.name : '',
    funder: project ? project.funder : '',
    travelerId,
    travelerName: traveler ? traveler.name : '',
    travelerTitle: traveler ? traveler.title : '',
    travelerPhone: traveler ? traveler.phone : '',
    residentStatus: traveler ? traveler.residentStatus : 'Resident',
    dob: traveler ? traveler.dob : '',
    passport: traveler ? traveler.passport : '',
    origin: req.body.origin || "Dar es Salaam",
    destination: req.body.destination || "Zanzibar",
    dates: req.body.dates || "12th-14th May, 2026",
    timePreference: req.body.timePreference || "Morning",
    advanceRequired: req.body.advanceRequired !== false,
    status: req.body.advanceRequired !== false ? 'Awaiting Advance Request' : 'Active (No Advance)',
    advance: null,
    retirement: null,
    createdAt: new Date().toISOString()
  };

  dbManager.saveActivity(act);
  res.json(act);
});

// SLACK SIMULATOR ROUTER

// 1. User types command in chat
app.post('/api/simulator/command', (req, res) => {
  const { command, userId } = req.body;
  const cmd = command.trim();

  if (cmd === '/lrf' || cmd === '/orgtivity-lrf') {
    const projects = dbManager.getProjects();
    const users = dbManager.getUsers();
    // Return LRF Modal schema
    const modalSchema = slackHandlers.buildLrfModal(projects, users);
    return res.json({
      type: 'modal',
      schema: modalSchema
    });
  } else if (cmd === '/rates') {
    const rates = dbManager.getRates();
    let text = "*Current Standard Rates per Location:*\n";
    rates.forEach(r => {
      text += `• *${r.location}*: Per Diem = ${r.perDiem.toLocaleString()} TZS, Hotel = ${r.hotel.toLocaleString()} TZS, Taxi = ${r.taxi.toLocaleString()} TZS\n`;
    });
    return res.json({
      type: 'message',
      text: text
    });
  } else {
    return res.json({
      type: 'message',
      text: `⚠️ Unknown command \`${cmd}\`. Try \`/lrf\` to start an activity or \`/rates\` to see allowances.`
    });
  }
});

// 2. Submit Slack modal
app.post('/api/simulator/submit', (req, res) => {
  const { callbackId, values, privateMetadata, userId } = req.body;

  try {
    if (callbackId === 'lrf_modal_submit') {
      const activity = slackHandlers.handleLrfSubmission(values);
      return res.json({
        success: true,
        message: `Activity *${activity.purpose}* created successfully!`,
        activity
      });
    }

    if (callbackId === 'lrf_sign_modal_submit') {
      const activityId = privateMetadata;
      const activity = slackHandlers.handleLrfSignSubmission(activityId, values, { approverId: userId });
      return res.json({
        success: true,
        message: `✅ LRF for *${activity.purpose}* signed off by *${activity.lrfApproval.approvedBy}*.`,
        activity
      });
    }

    if (callbackId === 'advance_modal_submit') {
      const activityId = privateMetadata;
      const activity = slackHandlers.handleAdvanceSubmission(activityId, values);
      return res.json({
        success: true,
        message: `Advance Request submitted for approval! Total: *TZS ${activity.advance.totalRequested.toLocaleString()}*`,
        activity
      });
    }

    if (callbackId === 'retirement_modal_submit') {
      const activityId = privateMetadata;
      const activity = slackHandlers.handleRetirementSubmission(activityId, values);
      const absNet = Math.abs(activity.retirement.netDue);
      const balText = activity.retirement.netDue > 0 
        ? `organization owes traveler *TZS ${absNet.toLocaleString()}*` 
        : `traveler owes organization *TZS ${absNet.toLocaleString()}*`;
      return res.json({
        success: true,
        message: `Retirement submitted for approval! Total Actual: *TZS ${activity.retirement.subtotal.toLocaleString()}* (${balText})`,
        activity
      });
    }

    return res.status(400).json({ error: `Unknown callback_id: ${callbackId}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. User clicks an interactive action (e.g. Approve/Reject, Fill Advance)
app.post('/api/simulator/action', (req, res) => {
  const { actionId, activityId, userId } = req.body;

  try {
    const activity = dbManager.getActivity(activityId);
    if (!activity) return res.status(404).json({ error: "Activity not found" });

    if (actionId === 'open_lrf_sign_modal') {
      const modalSchema = slackHandlers.buildLrfSignModal(activityId);
      return res.json({
        type: 'modal',
        schema: modalSchema
      });
    }

    if (actionId === 'open_advance_form') {
      const rates = dbManager.getRates();
      const modalSchema = slackHandlers.buildAdvanceModal(activityId, activity.travelerName, rates, activity.destination);
      return res.json({
        type: 'modal',
        schema: modalSchema
      });
    }

    if (actionId === 'approve_advance') {
      const updated = slackHandlers.handleAdvanceApproval(activityId, userId, true);
      return res.json({
        success: true,
        message: `✅ Advance Payment of *TZS ${updated.advance.totalRequested.toLocaleString()}* for *${updated.travelerName}* has been *APPROVED* by supervisor.`,
        activity: updated
      });
    }

    if (actionId === 'reject_advance') {
      const updated = slackHandlers.handleAdvanceApproval(activityId, userId, false);
      return res.json({
        success: true,
        message: `❌ Advance Payment for *${updated.travelerName}* has been *REJECTED* by supervisor.`,
        activity: updated
      });
    }

    if (actionId === 'open_retirement_form') {
      const expenseCats = dbManager.getExpenseCategories();
      const advanceAmount = activity.advance ? activity.advance.totalRequested : 0;
      const modalSchema = slackHandlers.buildRetirementModal(activityId, advanceAmount, expenseCats, activity.purpose);
      return res.json({
        type: 'modal',
        schema: modalSchema
      });
    }

    if (actionId === 'approve_retirement') {
      const updated = slackHandlers.handleRetirementApproval(activityId, userId, true);
      return res.json({
        success: true,
        message: `✅ Expense retirement for *${updated.travelerName}* has been *APPROVED* by supervisor. Trip retired!`,
        activity: updated
      });
    }

    if (actionId === 'reject_retirement') {
      const updated = slackHandlers.handleRetirementApproval(activityId, userId, false);
      return res.json({
        success: true,
        message: `❌ Expense retirement for *${updated.travelerName}* has been *REJECTED* by supervisor.`,
        activity: updated
      });
    }

    return res.status(400).json({ error: `Unknown action_id: ${actionId}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start express server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Orgtivity Automation Portal running at:`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`====================================================`);
});
