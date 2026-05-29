// Orgtivity Client Application

// Global State
let activities = [];
let projects = [];
let users = [];
let rates = [];
let categories = [];
let selectedActivityId = null;
let currentView = 'dashboard';
let currentSlackChannel = 'general';
let slackHistory = {
  'general': [
    {
      author: 'Orgtivity Bot',
      isBot: true,
      time: '10:00 AM',
      text: '🤖 Welcome to Orgtivity Bot! Let\'s automate your travel logistics and expenses.\nType `/lrf` in the input bar below to register a new travel activity, or `/rates` to view standard rates.'
    }
  ],
  'lrf-approvals': [],
  'finance': [],
  'bot-dm': [
    {
      author: 'Orgtivity Bot',
      isBot: true,
      time: '10:05 AM',
      text: 'Hi there! I am the Orgtivity assistant. I will DM you here when you need to fill in an Advance or Retirement form.'
    }
  ],
  'kassim-dm': [],
  'isaya-dm': []
};
let activeSlackModal = null; // Store current modal configuration

// DOM Elements
const views = {
  dashboard: document.getElementById('panel-dashboard'),
  simulator: document.getElementById('panel-simulator'),
  registry: document.getElementById('panel-registry'),
  settings: document.getElementById('panel-settings')
};
const navItems = document.querySelectorAll('.nav-item');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  loadData();
  setupEventListeners();
  setupSlackSimulator();
});

// Navigation Setup
function setupNavigation() {
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const viewName = item.getAttribute('data-view');
      switchView(viewName);
    });
  });
}

function switchView(viewName) {
  currentView = viewName;
  navItems.forEach(item => {
    if (item.getAttribute('data-view') === viewName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  Object.keys(views).forEach(key => {
    if (key === viewName) {
      views[key].classList.add('active');
    } else {
      views[key].classList.remove('active');
    }
  });

  if (viewName === 'registry') {
    renderRegistryList();
  } else if (viewName === 'dashboard') {
    renderDashboard();
  } else if (viewName === 'settings') {
    renderSettings();
  }
}

// Load Core Data
async function loadData() {
  try {
    const [pRes, uRes, rRes, cRes, aRes] = await Promise.all([
      fetch('/api/projects'),
      fetch('/api/users'),
      fetch('/api/rates'),
      fetch('/api/expense-categories'),
      fetch('/api/activities')
    ]);

    projects = await pRes.json();
    users = await uRes.json();
    rates = await rRes.json();
    categories = await cRes.json();
    activities = await aRes.json();

    // Auto-select first activity if available
    if (activities.length > 0 && !selectedActivityId) {
      selectedActivityId = activities[0].id;
    }

    renderDashboard();
    renderSimulatorContext();
    updateSlackConnectionStatus();
  } catch (error) {
    console.error("Error loading initial data:", error);
  }
}

function updateSlackConnectionStatus() {
  // If there are slack environment variables, the server would log it.
  // In the web client, we simulate connection to local Express server APIs.
  const dot = document.getElementById('slack-status-dot');
  const text = document.getElementById('slack-status-text');
  dot.classList.add('active');
  text.textContent = "Orgtivity Live & Simulation Connected";
}

// 1. DASHBOARD VIEW RENDER & LOGIC
function renderDashboard() {
  // Update Metrics
  document.getElementById('stat-total-activities').textContent = activities.length;
  
  const awaitingCount = activities.filter(a => 
    a.status.includes('Awaiting') || a.status.includes('Pending')
  ).length;
  document.getElementById('stat-pending-approvals').textContent = awaitingCount;

  let totalDisbursed = 0;
  activities.forEach(a => {
    if (a.advance && a.advance.status === 'Approved') {
      totalDisbursed += a.advance.totalRequested;
    }
  });
  document.getElementById('stat-total-disbursed').textContent = `${totalDisbursed.toLocaleString()} TZS`;

  const retiredCount = activities.filter(a => a.status === 'Retired').length;
  document.getElementById('stat-completed-retirements').textContent = retiredCount;

  // Render Table List
  const listContainer = document.getElementById('dashboard-activities-list');
  document.getElementById('registry-count').textContent = `${activities.length} items`;
  
  if (activities.length === 0) {
    listContainer.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">
          No activities registered yet. Start by typing <strong>/lrf</strong> in the Slack Simulator!
        </td>
      </tr>`;
    return;
  }

  listContainer.innerHTML = '';
  activities.slice().reverse().forEach(act => {
    const tr = document.createElement('tr');
    
    // Status Badge Class
    let badgeClass = 'badge-neutral';
    if (act.status === 'Active') badgeClass = 'badge-active';
    else if (act.status === 'Retired') badgeClass = 'badge-complete';
    else if (act.status.includes('Awaiting') || act.status.includes('Pending')) badgeClass = 'badge-pending';
    else if (act.status.includes('Rejected')) badgeClass = 'badge-rejected';

    const advanceText = act.advanceRequired 
      ? (act.advance ? `${act.advance.totalRequested.toLocaleString()} TZS` : 'Yes (Pending Form)')
      : 'No (Direct Retirement)';

    tr.innerHTML = `
      <td><strong>${act.travelerName}</strong><br><span style="font-size:0.75rem; color: var(--text-muted);">${act.travelerTitle}</span></td>
      <td><strong>${act.purpose}</strong><br><span style="font-size:0.75rem; color: var(--text-muted);">${act.projectName}</span></td>
      <td>${act.destination}</td>
      <td>${act.dates}</td>
      <td>${advanceText}</td>
      <td><span class="badge ${badgeClass}">${act.status}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="viewFormsFor('${act.id}')">View Forms</button>
        <button class="btn btn-secondary btn-sm" onclick="goToSlackSim('${act.id}')" style="background: var(--slack-sidebar); border: 1px solid rgba(255,255,255,0.1); color: #fff;">Test Slack</button>
      </td>
    `;
    listContainer.appendChild(tr);
  });
}

function viewFormsFor(id) {
  selectedActivityId = id;
  switchView('registry');
}

function goToSlackSim(id) {
  selectedActivityId = id;
  switchView('simulator');
  renderSimulatorContext();
}

function setupEventListeners() {
  // New LRF button from dashboard
  document.getElementById('btn-dashboard-new-lrf').addEventListener('click', () => {
    switchView('simulator');
    triggerMockCommand('/lrf');
  });
}

// 2. SLACK SIMULATOR VIEW RENDER & LOGIC
function setupSlackSimulator() {
  const channelItems = document.querySelectorAll('.slack-channel-item');
  const chatHeader = document.getElementById('slack-chat-channel-title');
  const inputForm = document.getElementById('slack-input-form');
  const inputField = document.getElementById('slack-input-field');

  // Channel switching
  channelItems.forEach(item => {
    item.addEventListener('click', () => {
      channelItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      currentSlackChannel = item.getAttribute('data-channel');
      
      let prefix = '# ';
      if (currentSlackChannel.includes('dm')) prefix = '👤 ';
      else if (currentSlackChannel === 'bot-dm') prefix = '🤖 ';

      chatHeader.textContent = prefix + item.textContent.replace(/[#👤🤖]/g, '').trim();
      renderSlackChatHistory();
    });
  });

  // Chat message submit
  inputForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const command = inputField.value.trim();
    if (command === '') return;

    inputField.value = '';
    
    // Add user message to history
    addSlackMessage('Isaya Mollel', false, command);

    // Process command
    if (command.startsWith('/') || command === 'lrf' || command === 'rates') {
      const sanitized = command.startsWith('/') ? command : '/' + command;
      await triggerMockCommand(sanitized);
    } else {
      setTimeout(() => {
        addSlackMessage('Orgtivity Bot', true, `💡 I didn't recognize that message. Try typing \`/lrf\` to start a logistics form, or \`/rates\` to see per diem scales.`);
      }, 500);
    }
  });

  // Modal Close & Cancel
  document.getElementById('slack-modal-close-btn').addEventListener('click', closeSlackModal);
  document.getElementById('slack-modal-cancel-btn').addEventListener('click', closeSlackModal);

  // Modal Submit
  document.getElementById('slack-modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeSlackModal) return;

    const values = extractModalFormValues();
    const bodyPayload = {
      callbackId: activeSlackModal.callback_id,
      values,
      privateMetadata: activeSlackModal.private_metadata,
      userId: 'usr-isaya' // Mocked user submitting
    };

    try {
      const res = await fetch('/api/simulator/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
      const data = await res.json();

      if (data.success) {
        closeSlackModal();
        
        // Push success response from bot
        addSlackMessage('Orgtivity Bot', true, data.message, 'bot-dm');
        
        // If it was LRF submit, trigger direct notifications to user
        if (activeSlackModal.callback_id === 'lrf_modal_submit') {
          const act = data.activity;
          selectedActivityId = act.id;
          
          addSlackMessage('Orgtivity Bot', true, `📢 *New Activity Registered:* *${act.purpose}* for *${act.travelerName}* (${act.destination}).`, 'general');
          
          if (act.advanceRequired) {
            // Notification in traveler's DM
            addSlackMessage(
              'Orgtivity Bot', 
              true, 
              `👋 Hi *${act.travelerName}*, an activity *${act.purpose}* has been scheduled for you. Since it requires advance payment, please fill in your Advance Request form.`,
              'kassim-dm',
              [
                {
                  type: 'section',
                  text: `Activity: *${act.purpose}*\nDestination: *${act.destination}*\nDates: *${act.dates}*`
                },
                {
                  type: 'actions',
                  elements: [
                    { type: 'button', text: 'Complete Advance Form', actionId: 'open_advance_form', activityId: act.id, style: 'primary' }
                  ]
                }
              ]
            );
          } else {
            // No advance needed, notify active status
            addSlackMessage(
              'Orgtivity Bot',
              true,
              `✅ Hi *${act.travelerName}*, activity *${act.purpose}* (Zanzibar SMT) has been authorized. You did not request advance. Please retire expenses and attach receipts after the trip.`,
              'kassim-dm',
              [
                {
                  type: 'actions',
                  elements: [
                    { type: 'button', text: 'Retire Expenses (Refund)', actionId: 'open_retirement_form', activityId: act.id, style: 'primary' }
                  ]
                }
              ]
            );
          }
        }

        // If it was Advance Form submit, send approval message to supervisor's channel or direct message
        if (activeSlackModal.callback_id === 'advance_modal_submit') {
          const act = data.activity;
          
          addSlackMessage(
            'Orgtivity Bot',
            true,
            `📥 *Advance Approval Request:* *${act.travelerName}* requested an advance of *TZS ${act.advance.totalRequested.toLocaleString()}* for *${act.purpose}*.`,
            'lrf-approvals',
            [
              {
                type: 'section',
                text: `*Employee:* ${act.travelerName} (${act.travelerTitle})\n*Activity:* ${act.purpose}\n*Budget:* TZS ${act.advance.totalRequested.toLocaleString()}\n\n*Line Items Requested:*`
              },
              {
                type: 'fields',
                fields: act.advance.items.map(item => `• *${item.description}*:\n  ${item.unitCost.toLocaleString()} x ${item.units} x ${item.frequency} = *${item.total.toLocaleString()} TZS*`)
              },
              {
                type: 'actions',
                elements: [
                  { type: 'button', text: 'Approve Advance', actionId: 'approve_advance', activityId: act.id, style: 'primary' },
                  { type: 'button', text: 'Reject Advance', actionId: 'reject_advance', activityId: act.id, style: 'danger' }
                ]
              }
            ]
          );
        }

        // If it was Retirement submit, send to lrf-approvals and finance channel
        if (activeSlackModal.callback_id === 'retirement_modal_submit') {
          const act = data.activity;
          const isRefund = act.retirement.netDue > 0;
          const absNet = Math.abs(act.retirement.netDue);
          const flowText = isRefund 
            ? `*Refund Due to Employee:* TZS ${absNet.toLocaleString()}` 
            : `*Payback Due to D-tree:* TZS ${absNet.toLocaleString()}`;

          addSlackMessage(
            'Orgtivity Bot',
            true,
            `📥 *Retirement Approval Request:* *${act.travelerName}* submitted expenses for *${act.purpose}*.`,
            'lrf-approvals',
            [
              {
                type: 'section',
                text: `*Activity:* ${act.purpose}\n*Advance Paid:* TZS ${act.retirement.advanceAmount.toLocaleString()}\n*Actual Expenses:* TZS ${act.retirement.subtotal.toLocaleString()}\n\n${flowText}\n*Receipts:* \`${act.retirement.receipts.join(', ')}\``
              },
              {
                type: 'fields',
                fields: act.retirement.expenses.map(exp => `• *[${exp.category}]* ${exp.memo}:\n  ${exp.unitCost.toLocaleString()} x ${exp.units} x ${exp.frequency} = *${exp.total.toLocaleString()} TZS*`)
              },
              {
                type: 'actions',
                elements: [
                  { type: 'button', text: 'Approve Retirement', actionId: 'approve_retirement', activityId: act.id, style: 'primary' },
                  { type: 'button', text: 'Reject Retirement', actionId: 'reject_retirement', activityId: act.id, style: 'danger' }
                ]
              }
            ]
          );
        }

        await loadData();
        renderSimulatorContext();
      } else {
        alert("Error: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Submission failed. Ensure backend server is running.");
    }
  });
}

// Trigger simulated slash command
async function triggerMockCommand(cmd) {
  try {
    const res = await fetch('/api/simulator/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, userId: 'usr-isaya' })
    });
    const data = await res.json();

    if (data.type === 'modal') {
      openSlackModal(data.schema);
    } else if (data.type === 'message') {
      addSlackMessage('Orgtivity Bot', true, data.text);
    }
  } catch (error) {
    addSlackMessage('Orgtivity Bot', true, `❌ Error calling command \`${cmd}\`. Is the server running?`);
  }
}

// Add message to chat log
function addSlackMessage(author, isBot, text, targetChannel = null) {
  const channel = targetChannel || currentSlackChannel;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  if (!slackHistory[channel]) {
    slackHistory[channel] = [];
  }
  
  slackHistory[channel].push({ author, isBot, time, text });
  
  if (channel === currentSlackChannel) {
    renderSlackChatHistory();
  }
}

// Add message with Block Kit attachments
function addSlackMessageWithBlocks(author, isBot, text, targetChannel, blocks) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  if (!slackHistory[targetChannel]) {
    slackHistory[targetChannel] = [];
  }

  slackHistory[targetChannel].push({ author, isBot, time, text, blocks });

  if (targetChannel === currentSlackChannel) {
    renderSlackChatHistory();
  }
}

// Custom function override for block kit message rendering
function addSlackMessage(author, isBot, text, targetChannel = null, blocks = null) {
  const channel = targetChannel || currentSlackChannel;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  if (!slackHistory[channel]) {
    slackHistory[channel] = [];
  }

  slackHistory[channel].push({ author, isBot, time, text, blocks });

  if (channel === currentSlackChannel) {
    renderSlackChatHistory();
  }
}

// Render history
function renderSlackChatHistory() {
  const container = document.getElementById('slack-chat-history');
  container.innerHTML = '';

  const msgs = slackHistory[currentSlackChannel] || [];
  msgs.forEach(msg => {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'slack-message';
    
    const initial = msg.author.charAt(0);
    const avatarClass = msg.isBot ? 'slack-avatar bot' : 'slack-avatar';
    
    let blocksHtml = '';
    if (msg.blocks) {
      blocksHtml = '<div class="slack-block-kit">';
      msg.blocks.forEach(block => {
        if (block.type === 'section') {
          blocksHtml += `<div class="slack-bk-section">${formatSlackMarkdown(block.text)}</div>`;
        } else if (block.type === 'fields') {
          blocksHtml += `<div class="slack-bk-fields">`;
          block.fields.forEach(f => {
            blocksHtml += `<div>${formatSlackMarkdown(f)}</div>`;
          });
          blocksHtml += `</div>`;
        } else if (block.type === 'actions') {
          blocksHtml += `<div class="slack-bk-actions">`;
          block.elements.forEach(btn => {
            const styleClass = btn.style === 'primary' ? 'slack-btn-primary' : (btn.style === 'danger' ? 'slack-btn-danger' : '');
            blocksHtml += `<button class="slack-btn ${styleClass}" onclick="handleSlackAction('${btn.actionId}', '${btn.activityId}')">${btn.text}</button>`;
          });
          blocksHtml += `</div>`;
        }
      });
      blocksHtml += '</div>';
    }

    msgDiv.innerHTML = `
      <div class="${avatarClass}">${msg.isBot ? '🤖' : initial}</div>
      <div class="slack-msg-content">
        <div class="slack-msg-header">
          <span class="slack-msg-author">${msg.author}</span>
          ${msg.isBot ? '<span class="slack-msg-bot-tag">BOT</span>' : ''}
          <span class="slack-msg-time">${msg.time}</span>
        </div>
        <div>${formatSlackMarkdown(msg.text)}</div>
        ${blocksHtml}
      </div>
    `;
    container.appendChild(msgDiv);
  });

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// Convert Slack *text* to <strong>, \`code\` to <code>
function formatSlackMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

// Handle clicking on button in Block Kit
async function handleSlackAction(actionId, activityId) {
  try {
    const res = await fetch('/api/simulator/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId, activityId, userId: 'usr-isaya' })
    });
    const data = await res.json();

    if (data.type === 'modal') {
      openSlackModal(data.schema);
    } else if (data.success) {
      // Print action feedback in chat
      addSlackMessage('Orgtivity Bot', true, data.message);
      
      // Additional DM notifications based on action completed
      if (actionId === 'approve_advance') {
        const act = data.activity;
        
        // Notify traveler in DM that advance was approved
        addSlackMessage(
          'Orgtivity Bot',
          true,
          `✅ Your Advance request of *TZS ${act.advance.totalRequested.toLocaleString()}* for *${act.purpose}* has been *APPROVED* by Isaya Mollel. Funds are being disbursed.\nOnce the trip is done, click below to retire your expenses.`,
          'kassim-dm',
          [
            {
              type: 'actions',
              elements: [
                { type: 'button', text: 'Retire Expenses', actionId: 'open_retirement_form', activityId: act.id, style: 'primary' }
              ]
            }
          ]
        );

        // Notify Finance
        addSlackMessage(
          'Orgtivity Bot',
          true,
          `💸 *Disbursement Authorized:* Please pay *TZS ${act.advance.totalRequested.toLocaleString()}* to *${act.travelerName}* for activity *${act.purpose}*.\nFunder Allocation: _${act.funder}_`,
          'finance'
        );
      }

      if (actionId === 'approve_retirement') {
        const act = data.activity;
        const absNet = Math.abs(act.retirement.netDue);
        
        // Notify Traveler
        if (act.retirement.netDue > 0) {
          addSlackMessage(
            'Orgtivity Bot',
            true,
            `✅ Your Retirement for *${act.purpose}* is *APPROVED* by Isaya Mollel.\nRefund payment of *TZS ${absNet.toLocaleString()}* has been forwarded to finance.`,
            'kassim-dm'
          );
          // Notify Finance
          addSlackMessage(
            'Orgtivity Bot',
            true,
            `💸 *Refund Authorized:* Please refund *TZS ${absNet.toLocaleString()}* to *${act.travelerName}* for retired activity *${act.purpose}*.\nApproved Expenses: TZS ${act.retirement.subtotal.toLocaleString()} vs Advance: TZS ${act.retirement.advanceAmount.toLocaleString()}`,
            'finance'
          );
        } else {
          addSlackMessage(
            'Orgtivity Bot',
            true,
            `✅ Your Retirement for *${act.purpose}* is *APPROVED* by Isaya Mollel.\nYou had an outstanding balance of *TZS ${absNet.toLocaleString()}* which must be repaid to D-tree office. Finance has been notified.`,
            'kassim-dm'
          );
          // Notify Finance
          addSlackMessage(
            'Orgtivity Bot',
            true,
            `📥 *Repayment Pending:* Traveler *${act.travelerName}* owes D-tree *TZS ${absNet.toLocaleString()}* for retired activity *${act.purpose}*.\nApproved Expenses: TZS ${act.retirement.subtotal.toLocaleString()} vs Advance: TZS ${act.retirement.advanceAmount.toLocaleString()}`,
            'finance'
          );
        }
      }

      await loadData();
      renderSimulatorContext();
    }
  } catch (err) {
    console.error(err);
    alert("Action failed to execute.");
  }
}

// Simulator Context List
function renderSimulatorContext() {
  const container = document.getElementById('simulator-context-list');
  if (activities.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 2rem; border: 1px dashed var(--border); border-radius: 8px;">
        No activities available. Create one to begin.
      </div>`;
    return;
  }

  container.innerHTML = '';
  activities.forEach(act => {
    const card = document.createElement('div');
    card.className = `registry-card ${selectedActivityId === act.id ? 'selected' : ''}`;
    
    // Status color dot
    let statusDotColor = 'var(--text-muted)';
    if (act.status === 'Active') statusDotColor = 'var(--success)';
    else if (act.status === 'Retired') statusDotColor = '#3b82f6';
    else if (act.status.includes('Awaiting')) statusDotColor = 'var(--warning)';

    card.innerHTML = `
      <div class="reg-card-header">
        <div class="reg-card-purpose">${act.purpose}</div>
        <div style="width: 10px; height: 10px; border-radius:50%; background:${statusDotColor}; flex-shrink:0;"></div>
      </div>
      <div class="reg-card-details">
        Traveler: <strong>${act.travelerName}</strong><br>
        Destination: ${act.destination}<br>
        Status: <em>${act.status}</em>
      </div>
    `;
    
    card.addEventListener('click', () => {
      selectedActivityId = act.id;
      renderSimulatorContext();
      
      // Auto switch Slack channel context to DM channel of traveler
      const channelItems = document.querySelectorAll('.slack-channel-item');
      channelItems.forEach(item => {
        const chan = item.getAttribute('data-channel');
        if (act.travelerId === 'usr-kassim' && chan === 'kassim-dm') {
          item.click();
        } else if (act.travelerId === 'usr-isaya' && chan === 'isaya-dm') {
          item.click();
        }
      });
    });

    container.appendChild(card);
  });
}

// 3. SLACK MODAL RENDER ENGINE
function openSlackModal(schema) {
  activeSlackModal = schema;
  document.getElementById('slack-modal-title').textContent = schema.title.text;
  
  const bodyContent = document.getElementById('slack-modal-body-content');
  bodyContent.innerHTML = '';

  schema.blocks.forEach(block => {
    if (block.type === 'section') {
      const p = document.createElement('div');
      p.className = 'slack-input-label';
      p.style.fontWeight = 'normal';
      p.innerHTML = formatSlackMarkdown(block.text.text);
      bodyContent.appendChild(p);
    }
    
    else if (block.type === 'divider') {
      const hr = document.createElement('hr');
      hr.style.borderColor = 'rgba(255, 255, 255, 0.08)';
      bodyContent.appendChild(hr);
    }
    
    else if (block.type === 'input') {
      const group = document.createElement('div');
      group.className = 'slack-input-group';
      group.setAttribute('data-block-id', block.block_id);
      
      const label = document.createElement('label');
      label.className = 'slack-input-label';
      label.textContent = block.label.text;
      group.appendChild(label);

      const el = block.element;
      if (el.type === 'plain_text_input') {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'slack-input-control';
        input.name = el.action_id;
        input.value = el.initial_value || '';
        input.placeholder = el.placeholder ? el.placeholder.text : '';
        group.appendChild(input);
      }
      
      else if (el.type === 'static_select') {
        const select = document.createElement('select');
        select.className = 'slack-input-control';
        select.name = el.action_id;
        
        el.options.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.text.text;
          if (el.initial_option && el.initial_option.value === opt.value) {
            o.selected = true;
          }
          select.appendChild(o);
        });
        group.appendChild(select);
      }

      else if (el.type === 'radio_buttons') {
        const radioContainer = document.createElement('div');
        radioContainer.style.display = 'flex';
        radioContainer.style.flexDirection = 'column';
        radioContainer.style.gap = '0.4rem';
        radioContainer.style.marginTop = '0.2rem';
        
        el.options.forEach(opt => {
          const row = document.createElement('label');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.gap = '0.5rem';
          row.style.fontSize = '0.85rem';
          row.style.color = '#fff';
          row.style.cursor = 'pointer';

          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = el.action_id;
          radio.value = opt.value;
          if (el.initial_option && el.initial_option.value === opt.value) {
            radio.checked = true;
          }
          
          row.appendChild(radio);
          row.append(opt.text.text);
          radioContainer.appendChild(row);
        });
        group.appendChild(radioContainer);
      }

      bodyContent.appendChild(group);
    }

    else if (block.type === 'actions') {
      // Renders input fields in a row
      const row = document.createElement('div');
      row.className = 'slack-input-row';
      row.setAttribute('data-block-id', block.block_id);

      block.elements.forEach(el => {
        if (el.type === 'plain_text_input') {
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'slack-input-control';
          input.name = el.action_id;
          input.value = el.initial_value || '';
          input.placeholder = el.placeholder ? el.placeholder.text : '';
          row.appendChild(input);
        } else if (el.type === 'static_select') {
          const select = document.createElement('select');
          select.className = 'slack-input-control';
          select.name = el.action_id;
          
          el.options.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.text.text;
            if (el.initial_option && el.initial_option.value === opt.value) {
              o.selected = true;
            }
            select.appendChild(o);
          });
          row.appendChild(select);
        }
      });
      bodyContent.appendChild(row);
    }
  });

  // Open Submit buttons label
  document.getElementById('slack-modal-submit-btn').textContent = schema.submit.text;
  document.getElementById('slack-modal-overlay').style.display = 'flex';
}

function closeSlackModal() {
  document.getElementById('slack-modal-overlay').style.display = 'none';
  activeSlackModal = null;
}

// Extract form values matching Slack payload structure
function extractModalFormValues() {
  const values = {};
  const bodyContent = document.getElementById('slack-modal-body-content');
  
  // Find all elements with block_id
  const blocks = bodyContent.querySelectorAll('[data-block-id]');
  blocks.forEach(block => {
    const blockId = block.getAttribute('data-block-id');
    values[blockId] = {};

    // Check simple inputs
    const inputs = block.querySelectorAll('input[type="text"], select');
    inputs.forEach(input => {
      const actionId = input.name;
      values[blockId][actionId] = {
        value: input.value
      };
    });

    // Check custom multi actions layout (like unit_cost, units, frequency side-by-side)
    if (block.classList.contains('slack-input-row')) {
      const inputs = block.querySelectorAll('input, select');
      inputs.forEach(input => {
        const actionId = input.placeholder ? input.placeholder.replace(' ', '_').toLowerCase() : input.name;
        values[blockId][actionId] = {
          value: input.value
        };
      });
    }

    // Check select static select structures
    const selects = block.querySelectorAll('select');
    selects.forEach(select => {
      const actionId = select.name;
      const selectedOption = select.options[select.selectedIndex];
      values[blockId][actionId] = {
        selected_option: {
          text: { text: selectedOption.textContent },
          value: selectedOption.value
        }
      };
    });

    // Check radio buttons
    const checkedRadio = block.querySelector('input[type="radio"]:checked');
    if (checkedRadio) {
      const actionId = checkedRadio.name;
      values[blockId][actionId] = {
        selected_option: {
          value: checkedRadio.value
        }
      };
    }
  });

  return values;
}

// 4. FORMS REGISTRY VIEW & A4 PRINT TEMPLATES
function renderRegistryList() {
  const selectList = document.getElementById('registry-select-list');
  if (activities.length === 0) {
    selectList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 1rem;">No activities.</div>`;
    document.getElementById('form-export-view').innerHTML = `
      <div style="text-align: center; padding: 5rem; color: #a0aec0;">
        Select an activity on the left to preview the D-tree forms.
      </div>`;
    return;
  }

  selectList.innerHTML = '';
  activities.forEach(act => {
    const item = document.createElement('div');
    item.className = `registry-card ${selectedActivityId === act.id ? 'selected' : ''}`;
    item.style.padding = '0.75rem';
    item.innerHTML = `
      <div style="font-weight:600; font-size:0.85rem; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${act.purpose}</div>
      <div style="font-size:0.75rem; color:var(--text-muted);">${act.travelerName}</div>
    `;
    item.addEventListener('click', () => {
      selectedActivityId = act.id;
      renderRegistryList();
      renderFormsViewer();
    });
    selectList.appendChild(item);
  });

  // Setup tab click
  const printTabs = document.querySelectorAll('.print-tab');
  printTabs.forEach(tab => {
    tab.onclick = () => {
      printTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderFormsViewer();
    };
  });

  renderFormsViewer();
}

function renderFormsViewer() {
  const container = document.getElementById('form-export-view');
  const activeTab = document.querySelector('.print-tab.active');
  if (!activeTab || !selectedActivityId) return;

  const formType = activeTab.getAttribute('data-form-type');
  const activity = activities.find(a => a.id === selectedActivityId);

  if (!activity) {
    container.innerHTML = `<div style="text-align:center; padding:5rem; color:#a0aec0;">Select an activity to view.</div>`;
    return;
  }

  if (formType === 'trf') {
    container.innerHTML = generateTrfHtml(activity);
  } else if (formType === 'advance') {
    container.innerHTML = generateAdvanceHtml(activity);
  } else if (formType === 'retirement') {
    container.innerHTML = generateRetirementHtml(activity);
  }
}

// PDF Form Generators
function generateTrfHtml(act) {
  const dateStr = new Date(act.createdAt).toLocaleDateString('en-GB');
  return `
    <div class="pdf-page">
      <div class="pdf-header">
        <img src="logo.svg" alt="D-tree Logo" class="pdf-logo">
        <div class="pdf-title-container">
          <div class="pdf-title">Travel Request Form</div>
        </div>
      </div>

      <div class="pdf-form-meta">
        <div class="pdf-meta-box">
          <div class="pdf-meta-label">1. Project and Purpose of Travel</div>
          <div class="pdf-meta-value">${act.purpose}</div>
          <div style="font-size: 8.5pt; color: #718096; margin-top: 4px;">Funder: ${act.funder} / ${act.projectName}</div>
        </div>
        <div class="pdf-meta-box">
          <div class="pdf-meta-label">2. Status of Traveler</div>
          <div class="pdf-meta-value">Staff (D-tree Staff Member)</div>
        </div>
      </div>

      <div class="pdf-form-meta">
        <div class="pdf-meta-box">
          <div class="pdf-meta-label">3. Traveler Name</div>
          <div class="pdf-meta-value">${act.travelerName}</div>
        </div>
        <div class="pdf-meta-box">
          <div class="pdf-meta-label">4. Traveler Title</div>
          <div class="pdf-meta-value">${act.travelerTitle}</div>
        </div>
      </div>

      <div class="pdf-form-meta">
        <div class="pdf-meta-box">
          <div class="pdf-meta-label">5. Traveler Local Phone Number</div>
          <div class="pdf-meta-value">${act.travelerPhone}</div>
        </div>
        <div class="pdf-meta-box">
          <div class="pdf-meta-label">6. TZ Status</div>
          <div class="pdf-meta-value">${act.residentStatus}</div>
        </div>
      </div>

      <div class="pdf-form-meta">
        <div class="pdf-meta-box">
          <div class="pdf-meta-label">7. Traveler Date of Birth (intl only)</div>
          <div class="pdf-meta-value">${act.dob ? new Date(act.dob).toLocaleDateString('en-GB') : 'N/A'}</div>
        </div>
        <div class="pdf-meta-box">
          <div class="pdf-meta-label">8. Preferred Airline</div>
          <div class="pdf-meta-value">N/A (SGR Train / Road Transport)</div>
        </div>
      </div>

      <div class="pdf-section-title">10. Travel Matrix Route</div>
      <table class="pdf-table">
        <thead>
          <tr>
            <th>Origin Location</th>
            <th>Destination Location</th>
            <th>Date of Travel</th>
            <th>Time Preference</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${act.origin}</td>
            <td>${act.destination}</td>
            <td>${act.dates}</td>
            <td>${act.timePreference}</td>
          </tr>
          <tr>
            <td>${act.destination}</td>
            <td>${act.origin}</td>
            <td>${act.dates}</td>
            <td>Evening</td>
          </tr>
        </tbody>
      </table>

      <div class="pdf-meta-box" style="margin-bottom: 25px;">
        <div class="pdf-meta-label">11. Other Notes (if applicable)</div>
        <div style="font-size: 10pt; color: #4a5568;">
          Advance requested: ${act.advanceRequired ? 'Yes' : 'No'}. 
          Approval routing triggered through D-tree Slack Bot integration.
        </div>
      </div>

      <div class="pdf-section-title">12. Sign Offs</div>
      <div style="font-size: 8.5pt; font-style: italic; color: #b7791f; margin-bottom: 10px;">For Travel Agent: Process only approved forms</div>
      
      <div class="pdf-signature-section">
        <div class="pdf-sig-box">
          <div class="pdf-signature-image">${act.travelerName.split(' ')[0]}</div>
          <strong>Requested By (Traveler)</strong><br>
          Name: ${act.travelerName}<br>
          Date: ${dateStr}
        </div>
        <div class="pdf-sig-box">
          <div class="pdf-signature-image" style="color: #2c5282;">Isaya</div>
          <strong>Approved By (Supervisor)</strong><br>
          Name: Isaya Mollel (Engineering Manager)<br>
          Date: ${dateStr}
        </div>
      </div>
    </div>
  `;
}

function generateAdvanceHtml(act) {
  if (!act.advanceRequired) {
    return `
      <div style="text-align: center; padding: 5rem; color: #718096; background: #fff;">
        <h3>No Advance Payment Form</h3>
        <p style="margin-top: 10px; font-size: 9.5pt;">The traveler did not request an advance for this activity.<br>Costs will be refunded directly post-trip upon retirement.</p>
      </div>`;
  }
  
  if (!act.advance) {
    return `
      <div style="text-align: center; padding: 5rem; color: #718096; background: #fff;">
        <h3>Advance Request Form Pending</h3>
        <p style="margin-top: 10px; font-size: 9.5pt;">The traveler has not yet completed the Advance Request Form in Slack.</p>
      </div>`;
  }

  const dateStr = new Date(act.advance.submittedAt).toLocaleDateString('en-GB');
  const appDateStr = act.advance.approvedAt ? new Date(act.advance.approvedAt).toLocaleDateString('en-GB') : 'PENDING';

  return `
    <div class="pdf-page">
      <div class="pdf-header">
        <img src="logo.svg" alt="D-tree Logo" class="pdf-logo">
        <div class="pdf-title-container">
          <div class="pdf-title">Advance Form</div>
        </div>
      </div>

      <div style="border: 1px solid #cbd5e0; margin-bottom: 20px; font-size: 10pt;">
        <div style="display: grid; grid-template-columns: 180px 1fr; border-bottom: 1px solid #cbd5e0;">
          <div style="background: #edf2f7; padding: 8px; font-weight: 700; border-right: 1px solid #cbd5e0;">Employee Name:</div>
          <div style="padding: 8px; font-weight: 600;">${act.travelerName}</div>
        </div>
        <div style="display: grid; grid-template-columns: 180px 1fr; border-bottom: 1px solid #cbd5e0;">
          <div style="background: #edf2f7; padding: 8px; font-weight: 700; border-right: 1px solid #cbd5e0;">Dates & Locations:</div>
          <div style="padding: 8px;">${act.dates} — Travel to ${act.destination}</div>
        </div>
        <div style="display: grid; grid-template-columns: 180px 1fr; border-bottom: 1px solid #cbd5e0;">
          <div style="background: #edf2f7; padding: 8px; font-weight: 700; border-right: 1px solid #cbd5e0;">Business Purpose:</div>
          <div style="padding: 8px; font-weight: 600;">${act.purpose}</div>
        </div>
        <div style="display: grid; grid-template-columns: 180px 1fr;">
          <div style="background: #edf2f7; padding: 8px; font-weight: 700; border-right: 1px solid #cbd5e0;">Project Name / Funder:</div>
          <div style="padding: 8px;">${act.projectName} (${act.funder})</div>
        </div>
      </div>

      <table class="pdf-table">
        <thead>
          <tr>
            <th>Item Description</th>
            <th style="text-align: right; width: 110px;">Unit Cost</th>
            <th style="text-align: center; width: 60px;">Units</th>
            <th style="text-align: center; width: 90px;">Frequency</th>
            <th style="text-align: right; width: 130px;">Total (TZS)</th>
          </tr>
        </thead>
        <tbody>
          ${act.advance.items.map(item => `
            <tr>
              <td>${item.description}</td>
              <td style="text-align: right;">${item.unitCost.toLocaleString()}</td>
              <td style="text-align: center;">${item.units}</td>
              <td style="text-align: center;">${item.frequency}</td>
              <td style="text-align: right; font-weight: 600;">${item.total.toLocaleString()}.00</td>
            </tr>
          `).join('')}
          <tr class="total-row">
            <td colspan="4" style="text-align: right; font-weight: 700;">Total Advance Requested:</td>
            <td style="text-align: right; font-weight: 700; font-size: 11pt;">${act.advance.totalRequested.toLocaleString()}.00</td>
          </tr>
        </tbody>
      </table>

      <div class="pdf-signature-section" style="margin-top: 50px;">
        <div class="pdf-sig-box">
          <div class="pdf-signature-image">${act.travelerName.split(' ')[0]}</div>
          <strong>Employee Signature</strong><br>
          Name: ${act.travelerName}<br>
          Date: ${dateStr}
        </div>
        <div class="pdf-sig-box">
          ${act.advance.status === 'Approved' 
            ? `<div class="pdf-signature-image" style="color: #2c5282;">Isaya</div>` 
            : `<div style="height:45px; display:flex; align-items:center; color: #e53e3e; font-weight:700; font-size:12pt; padding-left:20px;">PENDING APPROVAL</div>`}
          <strong>Approved by</strong><br>
          Name: ${act.advance.approvedBy || 'Isaya Mollel (Engineering Manager)'}<br>
          Date: ${appDateStr}
        </div>
      </div>
    </div>
  `;
}

function generateRetirementHtml(act) {
  if (!act.retirement) {
    return `
      <div style="text-align: center; padding: 5rem; color: #718096; background: #fff;">
        <h3>Expense Retirement Form Pending</h3>
        <p style="margin-top: 10px; font-size: 9.5pt;">This trip is active. Post-activity expenses and receipts have not yet been retired in Slack.</p>
      </div>`;
  }

  const dateStr = new Date(act.retirement.submittedAt).toLocaleDateString('en-GB');
  const appDateStr = act.retirement.approvedAt ? new Date(act.retirement.approvedAt).toLocaleDateString('en-GB') : 'PENDING';
  const isRefund = act.retirement.netDue > 0;
  const absNet = Math.abs(act.retirement.netDue);

  return `
    <div class="pdf-page">
      <div class="pdf-header">
        <img src="logo.svg" alt="D-tree Logo" class="pdf-logo">
        <div class="pdf-title-container">
          <div class="pdf-title" style="font-size: 16pt;">Universal Expense Form (Field Offices)</div>
        </div>
      </div>

      <div style="border: 1px solid #cbd5e0; margin-bottom: 20px; font-size: 9.5pt;">
        <div style="display: grid; grid-template-columns: 180px 1fr; border-bottom: 1px solid #cbd5e0;">
          <div style="background: #edf2f7; padding: 6px; font-weight: 700; border-right: 1px solid #cbd5e0;">Employee Name:</div>
          <div style="padding: 6px; font-weight: 600;">${act.travelerName}</div>
        </div>
        <div style="display: grid; grid-template-columns: 180px 1fr; border-bottom: 1px solid #cbd5e0;">
          <div style="background: #edf2f7; padding: 6px; font-weight: 700; border-right: 1px solid #cbd5e0;">Dates Expenses Incurred:</div>
          <div style="padding: 6px;">${act.dates}</div>
        </div>
        <div style="display: grid; grid-template-columns: 180px 1fr; border-bottom: 1px solid #cbd5e0;">
          <div style="background: #edf2f7; padding: 6px; font-weight: 700; border-right: 1px solid #cbd5e0;">Business Purpose/s:</div>
          <div style="padding: 6px; font-weight: 600;">${act.purpose}</div>
        </div>
        <div style="display: grid; grid-template-columns: 180px 1fr;">
          <div style="background: #edf2f7; padding: 6px; font-weight: 700; border-right: 1px solid #cbd5e0;">Funder:</div>
          <div style="padding: 6px;">${act.projectName} (${act.funder})</div>
        </div>
      </div>

      <table class="pdf-table" style="font-size: 9.5pt; margin-bottom: 15px;">
        <thead>
          <tr>
            <th>Expense Category</th>
            <th>Project Allocation</th>
            <th>Memo / Description</th>
            <th style="text-align: right; width: 90px;">Unit Cost</th>
            <th style="text-align: center; width: 50px;">Qty</th>
            <th style="text-align: center; width: 50px;">Freq</th>
            <th style="text-align: right; width: 110px;">Total (TZS)</th>
          </tr>
        </thead>
        <tbody>
          ${act.retirement.expenses.map(exp => `
            <tr>
              <td style="font-weight: 600; font-size: 9pt;">${exp.category}</td>
              <td style="font-size: 8.5pt;">${act.projectName.substring(0, 15)}...</td>
              <td style="font-size: 9pt;">${exp.memo}</td>
              <td style="text-align: right;">${exp.unitCost.toLocaleString()}</td>
              <td style="text-align: center;">${exp.units}</td>
              <td style="text-align: center;">${exp.frequency}</td>
              <td style="text-align: right; font-weight: 600;">${exp.total.toLocaleString()}.00</td>
            </tr>
          `).join('')}
          <tr class="total-row">
            <td colspan="6" style="text-align: right; font-weight: 700;">A. Subtotal actual costs:</td>
            <td style="text-align: right; font-weight: 700;">${act.retirement.subtotal.toLocaleString()}.00</td>
          </tr>
          <tr>
            <td colspan="6" style="text-align: right; font-weight: 600; color: #4a5568;">B. Less: Advance Amount Received:</td>
            <td style="text-align: right; font-weight: 600; color: #4a5568;">${act.retirement.advanceAmount.toLocaleString()}.00</td>
          </tr>
          <tr class="total-row" style="background: #edf2f7;">
            <td colspan="6" style="text-align: right; font-weight: 700;">= A - B. ${isRefund ? 'Total Due To Employee' : 'Total Due Back to D-tree'}:</td>
            <td style="text-align: right; font-weight: 800; font-size: 10.5pt; color: ${isRefund ? '#2b6cb0' : '#c53030'};">
              ${isRefund ? '' : '('}${absNet.toLocaleString()}.00${isRefund ? '' : ')'}
            </td>
          </tr>
        </tbody>
      </table>

      <div style="font-size: 8.5pt; background: #f7fafc; padding: 10px; border: 1px solid #cbd5e0; border-radius: 4px; margin-bottom: 25px;">
        <strong>Attached Receipts / Backups:</strong> ${act.retirement.receipts.length > 0 ? act.retirement.receipts.join(', ') : 'None'}
      </div>

      <div style="font-size: 8.5pt; color: #4a5568; line-height: 1.3; margin-bottom: 20px;">
        <strong>Requesting Employee:</strong> I certify that 1) the information included in this form and the attachments and backup documentation is accurate to the best of my knowledge and 2) all D-tree policies and procedures have been followed in making this request.
      </div>

      <div class="pdf-signature-section" style="margin-top: 30px;">
        <div class="pdf-sig-box">
          <div class="pdf-signature-image">${act.travelerName.split(' ')[0]}</div>
          <strong>Employee Signature & Title</strong><br>
          Name: ${act.travelerName} (${act.travelerTitle})<br>
          Date: ${dateStr}
        </div>
        <div class="pdf-sig-box">
          ${act.retirement.status === 'Approved' 
            ? `<div class="pdf-signature-image" style="color: #2c5282;">Isaya</div>` 
            : `<div style="height:45px; display:flex; align-items:center; color: #e53e3e; font-weight:700; font-size:12pt; padding-left:20px;">PENDING APPROVAL</div>`}
          <strong>Approval Signature & Title</strong><br>
          Name: ${act.retirement.approvedBy || 'Isaya Mollel (Engineering Manager)'}<br>
          Date: ${appDateStr}
        </div>
      </div>
    </div>
  `;
}

// 5. SETTINGS VIEW RENDER
function renderSettings() {
  // Populate Rates
  const ratesBody = document.getElementById('settings-rates-table');
  ratesBody.innerHTML = '';
  rates.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${r.location}</strong></td>
      <td>${r.perDiem.toLocaleString()} TZS</td>
      <td>${r.halfPerDiem.toLocaleString()} TZS</td>
      <td>${r.hotel.toLocaleString()} TZS</td>
      <td>${(r.sgr || r.flight || r.taxi).toLocaleString()} TZS</td>
    `;
    ratesBody.appendChild(tr);
  });

  // Populate Projects
  const projBody = document.getElementById('settings-projects-table');
  projBody.innerHTML = '';
  projects.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${p.name}</strong></td>
      <td>${p.funder}</td>
    `;
    projBody.appendChild(tr);
  });
}
