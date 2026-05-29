const { v4: uuidv4 } = require('uuid');
const dbManager = require('./db-manager');

// 1. BLOCKS & MODAL CONSTRUCTORS

// Construct LRF Modal
function buildLrfModal(projects, users) {
  return {
    type: "modal",
    callback_id: "lrf_modal_submit",
    title: { type: "plain_text", text: "Logistics Request Form" },
    submit: { type: "plain_text", text: "Submit LRF" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Create a new Logistics/Travel Request (LRF)*" }
      },
      {
        type: "input",
        block_id: "purpose_block",
        element: {
          type: "plain_text_input",
          action_id: "purpose",
          placeholder: { type: "plain_text", text: "e.g., UCS Technical Discussion & Workshop - Morogoro" }
        },
        label: { type: "plain_text", text: "Purpose of Travel / Activity Name" }
      },
      {
        type: "input",
        block_id: "project_block",
        element: {
          type: "static_select",
          action_id: "project",
          placeholder: { type: "plain_text", text: "Select Project" },
          options: projects.map(p => ({
            text: { type: "plain_text", text: p.name },
            value: p.id
          }))
        },
        label: { type: "plain_text", text: "Project Allocation" }
      },
      {
        type: "input",
        block_id: "traveler_block",
        element: {
          type: "static_select",
          action_id: "traveler",
          placeholder: { type: "plain_text", text: "Select Staff Member" },
          options: users.map(u => ({
            text: { type: "plain_text", text: `${u.name} (${u.title})` },
            value: u.id
          }))
        },
        label: { type: "plain_text", text: "Traveler Name" }
      },
      {
        type: "section",
        block_id: "travel_details_section",
        text: { type: "mrkdwn", text: "*Travel Information*" }
      },
      {
        type: "input",
        block_id: "origin_block",
        element: {
          type: "plain_text_input",
          action_id: "origin",
          initial_value: "Dar es Salaam"
        },
        label: { type: "plain_text", text: "Origin Location" }
      },
      {
        type: "input",
        block_id: "destination_block",
        element: {
          type: "plain_text_input",
          action_id: "destination",
          placeholder: { type: "plain_text", text: "e.g., Morogoro, Zanzibar" }
        },
        label: { type: "plain_text", text: "Destination Location" }
      },
      {
        type: "input",
        block_id: "dates_block",
        element: {
          type: "plain_text_input",
          action_id: "dates",
          placeholder: { type: "plain_text", text: "e.g., 04th-05th December, 2025" }
        },
        label: { type: "plain_text", text: "Travel Dates" }
      },
      {
        type: "input",
        block_id: "time_pref_block",
        element: {
          type: "static_select",
          action_id: "time_pref",
          initial_option: {
            text: { type: "plain_text", text: "Morning" },
            value: "Morning"
          },
          options: [
            { text: { type: "plain_text", text: "Morning" }, value: "Morning" },
            { text: { type: "plain_text", text: "Afternoon" }, value: "Afternoon" },
            { text: { type: "plain_text", text: "Evening" }, value: "Evening" }
          ]
        },
        label: { type: "plain_text", text: "Time Preference" }
      },
      {
        type: "input",
        block_id: "advance_req_block",
        element: {
          type: "radio_buttons",
          action_id: "advance_req",
          initial_option: {
            text: { type: "plain_text", text: "Yes - Requires Advance Payment" },
            value: "yes"
          },
          options: [
            { text: { type: "plain_text", text: "Yes - Requires Advance Payment" }, value: "yes" },
            { text: { type: "plain_text", text: "No - Direct Retirement (Refund post-trip)" }, value: "no" }
          ]
        },
        label: { type: "plain_text", text: "Advance Payment Needed?" }
      }
    ]
  };
}

// Construct Advance Request Modal (pre-populated with rates where possible)
function buildAdvanceModal(activityId, travelerName, rates, destination) {
  // Try to find rate rules for this destination
  const destRate = rates.find(r => r.location.toLowerCase() === destination.toLowerCase()) || {
    perDiem: 90000,
    halfPerDiem: 45000,
    hotel: 100000,
    taxi: 20000
  };

  // Generate suggested items
  const suggestedItems = [
    { name: `Half per diem for 2 days in ${destination} attending workshop`, cost: destRate.halfPerDiem, units: 1, freq: 2 },
    { name: `Travel fare (to/from ${destination})`, cost: destRate.sgr || destRate.flight || 50500, units: 1, freq: 2 },
    { name: `Taxi Fee (to/from station/airport) in ${destination}`, cost: destRate.taxi, units: 1, freq: 2 }
  ];

  return {
    type: "modal",
    callback_id: "advance_modal_submit",
    private_metadata: activityId,
    title: { type: "plain_text", text: "Advance Request Form" },
    submit: { type: "plain_text", text: "Submit Advance Request" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Fill out the Advance Request for traveler: ${travelerName}*` }
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `Rates auto-filled for destination *${destination}*` }
        ]
      },
      { type: "divider" },
      // Row 1
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Item 1: Per Diem*` }
      },
      {
        type: "input",
        block_id: "item1_desc",
        element: { type: "plain_text_input", action_id: "val", initial_value: suggestedItems[0].name },
        label: { type: "plain_text", text: "Description" }
      },
      {
        type: "actions",
        block_id: "item1_fields",
        elements: [
          { type: "plain_text_input", action_id: "unit_cost", initial_value: String(suggestedItems[0].cost), placeholder: { type: "plain_text", text: "Unit Cost" } },
          { type: "plain_text_input", action_id: "units", initial_value: String(suggestedItems[0].units), placeholder: { type: "plain_text", text: "Units" } },
          { type: "plain_text_input", action_id: "freq", initial_value: String(suggestedItems[0].freq), placeholder: { type: "plain_text", text: "Frequency" } }
        ]
      },
      { type: "divider" },
      // Row 2
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Item 2: Transport Cost*` }
      },
      {
        type: "input",
        block_id: "item2_desc",
        element: { type: "plain_text_input", action_id: "val", initial_value: suggestedItems[1].name },
        label: { type: "plain_text", text: "Description" }
      },
      {
        type: "actions",
        block_id: "item2_fields",
        elements: [
          { type: "plain_text_input", action_id: "unit_cost", initial_value: String(suggestedItems[1].cost), placeholder: { type: "plain_text", text: "Unit Cost" } },
          { type: "plain_text_input", action_id: "units", initial_value: String(suggestedItems[1].units), placeholder: { type: "plain_text", text: "Units" } },
          { type: "plain_text_input", action_id: "freq", initial_value: String(suggestedItems[1].freq), placeholder: { type: "plain_text", text: "Frequency" } }
        ]
      },
      { type: "divider" },
      // Row 3
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Item 3: Local Taxi / Other*` }
      },
      {
        type: "input",
        block_id: "item3_desc",
        element: { type: "plain_text_input", action_id: "val", initial_value: suggestedItems[2].name },
        label: { type: "plain_text", text: "Description" }
      },
      {
        type: "actions",
        block_id: "item3_fields",
        elements: [
          { type: "plain_text_input", action_id: "unit_cost", initial_value: String(suggestedItems[2].cost), placeholder: { type: "plain_text", text: "Unit Cost" } },
          { type: "plain_text_input", action_id: "units", initial_value: String(suggestedItems[2].units), placeholder: { type: "plain_text", text: "Units" } },
          { type: "plain_text_input", action_id: "freq", initial_value: String(suggestedItems[2].freq), placeholder: { type: "plain_text", text: "Frequency" } }
        ]
      }
    ]
  };
}

// Construct Retirement Modal
function buildRetirementModal(activityId, advanceAmount, expenseCategories, activityName) {
  return {
    type: "modal",
    callback_id: "retirement_modal_submit",
    private_metadata: activityId,
    title: { type: "plain_text", text: "Retirement Form" },
    submit: { type: "plain_text", text: "Submit Retirement" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Universal Expense Retirement* \nActivity: _${activityName}_\nAdvance Received: *TZS ${advanceAmount.toLocaleString()}*` }
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Expense Item 1: Per Diem*" }
      },
      {
        type: "actions",
        block_id: "ret1_details",
        elements: [
          {
            type: "static_select",
            action_id: "category",
            placeholder: { type: "plain_text", text: "Category" },
            initial_option: { text: { type: "plain_text", text: "Per Diem" }, value: "Per Diem" },
            options: expenseCategories.map(c => ({ text: { type: "plain_text", text: c }, value: c }))
          },
          { type: "plain_text_input", action_id: "memo", initial_value: "1/2 per diem for attending workshop", placeholder: { type: "plain_text", text: "Memo/Description" } },
          { type: "plain_text_input", action_id: "cost", initial_value: "45000", placeholder: { type: "plain_text", text: "Unit Cost" } },
          { type: "plain_text_input", action_id: "units", initial_value: "1", placeholder: { type: "plain_text", text: "Units" } },
          { type: "plain_text_input", action_id: "freq", initial_value: "2", placeholder: { type: "plain_text", text: "Frequency" } }
        ]
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Expense Item 2: Transport*" }
      },
      {
        type: "actions",
        block_id: "ret2_details",
        elements: [
          {
            type: "static_select",
            action_id: "category",
            placeholder: { type: "plain_text", text: "Category" },
            initial_option: { text: { type: "plain_text", text: "Travel - misc" }, value: "Travel - misc" },
            options: expenseCategories.map(c => ({ text: { type: "plain_text", text: c }, value: c }))
          },
          { type: "plain_text_input", action_id: "memo", initial_value: "Return SGR Fare", placeholder: { type: "plain_text", text: "Memo/Description" } },
          { type: "plain_text_input", action_id: "cost", initial_value: "50500", placeholder: { type: "plain_text", text: "Unit Cost" } },
          { type: "plain_text_input", action_id: "units", initial_value: "1", placeholder: { type: "plain_text", text: "Units" } },
          { type: "plain_text_input", action_id: "freq", initial_value: "2", placeholder: { type: "plain_text", text: "Frequency" } }
        ]
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Expense Item 3: Local Transport*" }
      },
      {
        type: "actions",
        block_id: "ret3_details",
        elements: [
          {
            type: "static_select",
            action_id: "category",
            placeholder: { type: "plain_text", text: "Category" },
            initial_option: { text: { type: "plain_text", text: "Ground transport" }, value: "Ground Transport" },
            options: expenseCategories.map(c => ({ text: { type: "plain_text", text: c }, value: c }))
          },
          { type: "plain_text_input", action_id: "memo", initial_value: "Taxi cost from SGR to Hotel and back", placeholder: { type: "plain_text", text: "Memo/Description" } },
          { type: "plain_text_input", action_id: "cost", initial_value: "40000", placeholder: { type: "plain_text", text: "Unit Cost" } },
          { type: "plain_text_input", action_id: "units", initial_value: "1", placeholder: { type: "plain_text", text: "Units" } },
          { type: "plain_text_input", action_id: "freq", initial_value: "1", placeholder: { type: "plain_text", text: "Frequency" } }
        ]
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Expense Item 4: Hotel / Accommodation*" }
      },
      {
        type: "actions",
        block_id: "ret4_details",
        elements: [
          {
            type: "static_select",
            action_id: "category",
            placeholder: { type: "plain_text", text: "Category" },
            initial_option: { text: { type: "plain_text", text: "Hotel" }, value: "Hotel" },
            options: expenseCategories.map(c => ({ text: { type: "plain_text", text: c }, value: c }))
          },
          { type: "plain_text_input", action_id: "memo", initial_value: "One night stay at hotel", placeholder: { type: "plain_text", text: "Memo/Description" } },
          { type: "plain_text_input", action_id: "cost", initial_value: "100000", placeholder: { type: "plain_text", text: "Unit Cost" } },
          { type: "plain_text_input", action_id: "units", initial_value: "1", placeholder: { type: "plain_text", text: "Units" } },
          { type: "plain_text_input", action_id: "freq", initial_value: "1", placeholder: { type: "plain_text", text: "Frequency" } }
        ]
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Expense Item 5: Additional Transport (e.g. Home to SGR)*" }
      },
      {
        type: "actions",
        block_id: "ret5_details",
        elements: [
          {
            type: "static_select",
            action_id: "category",
            placeholder: { type: "plain_text", text: "Category" },
            initial_option: { text: { type: "plain_text", text: "Ground transport" }, value: "Ground Transport" },
            options: expenseCategories.map(c => ({ text: { type: "plain_text", text: c }, value: c }))
          },
          { type: "plain_text_input", action_id: "memo", initial_value: "Taxi in Dar from Home to SGR and back", placeholder: { type: "plain_text", text: "Memo/Description" } },
          { type: "plain_text_input", action_id: "cost", initial_value: "40000", placeholder: { type: "plain_text", text: "Unit Cost" } },
          { type: "plain_text_input", action_id: "units", initial_value: "1", placeholder: { type: "plain_text", text: "Units" } },
          { type: "plain_text_input", action_id: "freq", initial_value: "1", placeholder: { type: "plain_text", text: "Frequency" } }
        ]
      },
      { type: "divider" },
      {
        type: "input",
        block_id: "receipts_block",
        element: {
          type: "plain_text_input",
          action_id: "receipts",
          initial_value: "sgr_receipt.pdf, hotel_invoice.pdf, taxi_receipts.jpg",
          placeholder: { type: "plain_text", text: "List attached receipts files" }
        },
        label: { type: "plain_text", text: "Attached Receipts (comma-separated file names)" }
      }
    ]
  };
}

// 2. STATE SUBMISSION HANDLERS

// Handle LRF Modal Submit
function handleLrfSubmission(viewValues) {
  const purpose = viewValues.purpose_block.purpose.value;
  const projectId = viewValues.project_block.project.selected_option.value;
  const travelerId = viewValues.traveler_block.traveler.selected_option.value;
  const origin = viewValues.origin_block.origin.value;
  const destination = viewValues.destination_block.destination.value;
  const dates = viewValues.dates_block.dates.value;
  const timePref = viewValues.time_pref_block.time_pref.selected_option.value;
  const advanceReq = viewValues.advance_req_block.advance_req.selected_option.value === 'yes';

  const projects = dbManager.getProjects();
  const users = dbManager.getUsers();

  const project = projects.find(p => p.id === projectId);
  const traveler = users.find(u => u.id === travelerId);

  const newActivity = {
    id: `act-${uuidv4().substring(0, 8)}`,
    purpose,
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
    origin,
    destination,
    dates,
    timePreference: timePref,
    advanceRequired: advanceReq,
    status: advanceReq ? 'Awaiting Advance Request' : 'Active (No Advance)',
    advance: null,
    retirement: null,
    createdAt: new Date().toISOString()
  };

  dbManager.saveActivity(newActivity);
  return newActivity;
}

// Handle Advance Modal Submit
function handleAdvanceSubmission(activityId, viewValues) {
  const activity = dbManager.getActivity(activityId);
  if (!activity) throw new Error("Activity not found");

  const items = [];
  let totalAdvance = 0;

  // Process rows if they have data
  for (let i = 1; i <= 3; i++) {
    const descBlock = viewValues[`item${i}_desc`]?.val;
    const fieldsBlock = viewValues[`item${i}_fields`];
    
    if (descBlock && fieldsBlock) {
      const description = descBlock.value;
      const unitCost = parseFloat(fieldsBlock.unit_cost.value) || 0;
      const units = parseFloat(fieldsBlock.units.value) || 0;
      const frequency = parseFloat(fieldsBlock.freq.value) || 0;
      const total = unitCost * units * frequency;

      if (description.trim() !== '') {
        items.push({
          description,
          unitCost,
          units,
          frequency,
          total
        });
        totalAdvance += total;
      }
    }
  }

  activity.advance = {
    items,
    totalRequested: totalAdvance,
    status: 'Pending Approval',
    submittedAt: new Date().toISOString(),
    approvedBy: null,
    approvedAt: null
  };
  activity.status = 'Awaiting Advance Approval';

  dbManager.saveActivity(activity);
  return activity;
}

// Handle Advance Approval
function handleAdvanceApproval(activityId, supervisorId, approved) {
  const activity = dbManager.getActivity(activityId);
  if (!activity) throw new Error("Activity not found");
  if (!activity.advance) throw new Error("Advance request not found");

  const supervisor = dbManager.getUsers().find(u => u.id === supervisorId);

  if (approved) {
    activity.advance.status = 'Approved';
    activity.advance.approvedBy = supervisor ? supervisor.name : 'Supervisor';
    activity.advance.approvedAt = new Date().toISOString();
    activity.status = 'Active'; // Trip is active
  } else {
    activity.advance.status = 'Rejected';
    activity.status = 'Advance Rejected';
  }

  dbManager.saveActivity(activity);
  return activity;
}

// Handle Retirement Modal Submit
function handleRetirementSubmission(activityId, viewValues) {
  const activity = dbManager.getActivity(activityId);
  if (!activity) throw new Error("Activity not found");

  const expenses = [];
  let subtotal = 0;

  // Read the 5 potential retirement expense slots
  for (let i = 1; i <= 5; i++) {
    const details = viewValues[`ret${i}_details`];
    if (details) {
      const category = details.category.selected_option.value;
      const memo = details.memo.value;
      const unitCost = parseFloat(details.cost.value) || 0;
      const units = parseFloat(details.units.value) || 0;
      const frequency = parseFloat(details.freq.value) || 0;
      const total = unitCost * units * frequency;

      if (memo.trim() !== '') {
        expenses.push({
          category,
          memo,
          unitCost,
          units,
          frequency,
          total,
          date: activity.dates // standard fallback
        });
        subtotal += total;
      }
    }
  }

  const receiptsStr = viewValues.receipts_block.receipts.value || '';
  const receipts = receiptsStr.split(',').map(r => r.trim()).filter(r => r !== '');

  const advanceAmount = activity.advance ? activity.advance.totalRequested : 0;
  const netDue = subtotal - advanceAmount;

  activity.retirement = {
    expenses,
    subtotal,
    advanceAmount,
    netDue, // Positive means Due to Employee, Negative means Due back to D-tree
    receipts,
    status: 'Pending Approval',
    submittedAt: new Date().toISOString(),
    approvedBy: null,
    approvedAt: null
  };
  activity.status = 'Awaiting Retirement Approval';

  dbManager.saveActivity(activity);
  return activity;
}

// Handle Retirement Approval
function handleRetirementApproval(activityId, supervisorId, approved) {
  const activity = dbManager.getActivity(activityId);
  if (!activity) throw new Error("Activity not found");
  if (!activity.retirement) throw new Error("Retirement not found");

  const supervisor = dbManager.getUsers().find(u => u.id === supervisorId);

  if (approved) {
    activity.retirement.status = 'Approved';
    activity.retirement.approvedBy = supervisor ? supervisor.name : 'Supervisor';
    activity.retirement.approvedAt = new Date().toISOString();
    activity.status = 'Retired'; // Final state
  } else {
    activity.retirement.status = 'Rejected';
    activity.status = 'Retirement Rejected';
  }

  dbManager.saveActivity(activity);
  return activity;
}

function translateModalToSlack(view) {
  const convertedBlocks = [];
  for (const block of view.blocks) {
    if (block.type === 'actions') {
      const hasInputs = block.elements.some(el => el.type === 'plain_text_input' || el.type === 'static_select');
      if (hasInputs) {
        for (const el of block.elements) {
          let labelText = el.action_id;
          if (el.action_id === 'unit_cost' || el.action_id === 'cost') labelText = 'Unit Cost';
          else if (el.action_id === 'units') labelText = 'Units';
          else if (el.action_id === 'freq') labelText = 'Frequency';
          else if (el.action_id === 'category') labelText = 'Expense Category';
          else if (el.action_id === 'memo') labelText = 'Memo / Description';
          
          labelText = labelText.charAt(0).toUpperCase() + labelText.slice(1);

          convertedBlocks.push({
            type: 'input',
            block_id: `${block.block_id}_${el.action_id}`,
            element: el,
            label: { type: 'plain_text', text: labelText },
            optional: el.action_id === 'memo' ? true : false
          });
        }
        continue;
      }
    }
    convertedBlocks.push(block);
  }
  return {
    ...view,
    blocks: convertedBlocks
  };
}

function translateSlackSubmissionToSimulator(viewValues) {
  const simulatorValues = {};
  for (const blockId in viewValues) {
    simulatorValues[blockId] = { ...viewValues[blockId] };
  }
  for (const blockId in viewValues) {
    const parts = blockId.split('_');
    if (parts.length > 1) {
      const actionId = parts[parts.length - 1];
      const originalBlockId = parts.slice(0, -1).join('_');
      if (['unit_cost', 'units', 'freq', 'category', 'memo', 'cost'].includes(actionId)) {
        if (!simulatorValues[originalBlockId]) {
          simulatorValues[originalBlockId] = {};
        }
        simulatorValues[originalBlockId][actionId] = viewValues[blockId][actionId];
      }
    }
  }
  return simulatorValues;
}

module.exports = {
  buildLrfModal,
  buildAdvanceModal,
  buildRetirementModal,
  handleLrfSubmission,
  handleAdvanceSubmission,
  handleAdvanceApproval,
  handleRetirementSubmission,
  handleRetirementApproval,
  translateModalToSlack,
  translateSlackSubmissionToSimulator
};
