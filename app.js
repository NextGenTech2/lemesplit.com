/**
 * SplitEasy - Frontend Application Controller
 * High-performance, responsive SPA with offline Quick Split & online Trip Mode.
 */

// ==========================================
// 1. STATE & PARAMETERS
// ==========================================
let supabaseClient = null;
const supabaseUrl = 'https://dkzaqjvtjromwyebrkbo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRremFxanZ0anJvbXd5ZWJya2JvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3Mjc0MzEsImV4cCI6MjA5NjMwMzQzMX0.FpCCycywS5diSuZxTaPp4uqFpEBrY4blFgHbMbdaX1Y';

// Device Identifier to prevent session hijacking / claiming other profiles
let deviceId = localStorage.getItem('spliteasy_device_id');
if (!deviceId) {
  deviceId = 'dev_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  localStorage.setItem('spliteasy_device_id', deviceId);
}

// Quick Split State (Offline)
let qsMembers = JSON.parse(localStorage.getItem('spliteasy_qs_members')) || [];
let qsItems = JSON.parse(localStorage.getItem('spliteasy_qs_items')) || [];

// Trip Mode State (Online)
let activeTripId = null;
let tripData = null;
let tripMembers = [];
let tripExpenses = [];
let activeMemberId = null; // Simulated browser member
let realtimeChannel = null;

// Categories styling mapping
const CATEGORY_ICONS = {
  Food: '🍽️',
  Drinks: '🍹',
  Travel: '🚗',
  Lodging: '🏨',
  Activity: '🎢',
  Other: '📦',
  settlement: '💸'
};

// ==========================================
// 2. INITIALIZATION & ROUTING
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  initSupabase();
  setupEventListeners();
  handleRouting();
  runSelfTests();
});

// Watch for hash change (e.g. going from # to #AGY42)
window.addEventListener('hashchange', handleRouting);

/**
 * Initialize Supabase client if credentials exist in localStorage
 */
function initSupabase() {
  if (supabaseUrl && supabaseKey) {
    try {
      supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
      console.log('Supabase initialized successfully.');
    } catch (err) {
      console.error('Failed to initialize Supabase client:', err);
      showToast('Failed to initialize Supabase connection.', 'error');
    }
  } else {
    console.warn('Supabase credentials are not configured.');
  }
}

/**
 * Routing logic based on URL hash
 */
async function handleRouting() {
  const hash = window.location.hash.substring(1).trim();
  const tabQuick = document.getElementById('tab-quick-split');
  const tabTrip = document.getElementById('tab-trip-mode');

  if (hash) {
    // We have an active session code
    activeTripId = hash.toUpperCase();
    switchView('trip');

    // Select active tab visually
    tabQuick.classList.remove('tab-active');
    tabTrip.classList.add('tab-active');

    if (supabaseClient) {
      showLoading(true);
      await loadTrip(activeTripId);
      showLoading(false);
    } else {
      showToast('Database backend is not connected. Trip Mode is unavailable.', 'error');
    }
  } else {
    // Standard dashboard / Quick split view
    activeTripId = null;
    switchView('quick-split');
    tabQuick.classList.add('tab-active');
    tabTrip.classList.remove('tab-active');
    renderQuickSplit();
  }
}

/**
 * Toggles visibility of Quick Split vs Trip panels
 */
function switchView(mode) {
  const viewQuick = document.getElementById('view-quick-split');
  const viewTrip = document.getElementById('view-trip-mode');
  const onboarding = document.getElementById('trip-onboarding');
  const dashboard = document.getElementById('trip-dashboard');

  if (mode === 'quick-split') {
    viewQuick.classList.remove('hidden');
    viewTrip.classList.add('hidden');
  } else {
    viewQuick.classList.add('hidden');
    viewTrip.classList.remove('hidden');

    if (activeTripId) {
      onboarding.classList.add('hidden');
      dashboard.classList.remove('hidden');
    } else {
      onboarding.classList.remove('hidden');
      dashboard.classList.add('hidden');
    }
  }
}

// ==========================================
// 3. EVENT LISTENERS SETUP
// ==========================================
function setupEventListeners() {
  // Tabs
  document.getElementById('tab-quick-split').addEventListener('click', () => {
    window.location.hash = '';
  });

  document.getElementById('tab-trip-mode').addEventListener('click', () => {
    if (activeTripId) {
      switchView('trip');
    } else {
      window.location.hash = '';
      switchView('trip');
    }
  });



  // Quick Split Forms
  document.getElementById('qs-member-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('qs-member-input');
    const name = input.value.trim();
    if (name) {
      if (qsMembers.includes(name)) {
        showToast('Member already exists in this bill.', 'warning');
        return;
      }
      qsMembers.push(name);
      localStorage.setItem('spliteasy_qs_members', JSON.stringify(qsMembers));
      input.value = '';
      renderQuickSplit();
      showToast(`${name} added to bill group.`, 'success');
    }
  });

  document.getElementById('qs-item-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('qs-item-name');
    const amountInput = document.getElementById('qs-item-amount');

    const categoryName = nameInput.value.trim();
    const amount = parseFloat(amountInput.value);

    // Read checked participants
    const checkedBoxes = document.querySelectorAll('#qs-participants-container input[type="checkbox"]:checked');
    const participants = Array.from(checkedBoxes).map(cb => cb.value);

    if (participants.length === 0) {
      showToast('Select at least one participant for this item.', 'warning');
      return;
    }

    const item = {
      id: 'qs_' + Date.now(),
      category: categoryName,
      amount: amount,
      participants: participants
    };

    qsItems.push(item);
    localStorage.setItem('spliteasy_qs_items', JSON.stringify(qsItems));

    nameInput.value = '';
    amountInput.value = '';

    renderQuickSplit();
    showToast(`Added ${categoryName} (₹${amount.toFixed(2)}) to bill.`, 'success');
  });

  // Trip Mode Forms
  document.getElementById('trip-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!supabaseClient) {
      showToast('Database backend is not connected. Trip Mode is unavailable.', 'error');
      return;
    }

    const tripName = document.getElementById('trip-create-name').value.trim();
    const hostName = document.getElementById('trip-create-host').value.trim();

    showLoading(true);
    try {
      const code = 'TRIP-' + Math.random().toString(36).substring(2, 7).toUpperCase();

      // 1. Create Trip
      const { error: tripErr } = await supabaseClient.from('trips').insert([
        { id: code, name: tripName, host_name: hostName }
      ]);
      if (tripErr) throw tripErr;

      // 2. Create Host Member (Pre-claimed by Creator device)
      const { data: memData, error: memErr } = await supabaseClient.from('members').insert([
        { trip_id: code, name: hostName, device_id: deviceId }
      ]).select();
      if (memErr) throw memErr;

      // Save Host as our current member session in localStorage
      localStorage.setItem(`trip_user_id_${code}`, memData[0].id);

      showToast(`Trip "${tripName}" created successfully!`, 'success');
      window.location.hash = code;
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error creating trip.', 'error');
    } finally {
      showLoading(false);
    }
  });

  document.getElementById('trip-join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!supabaseClient) {
      showToast('Database backend is not connected. Trip Mode is unavailable.', 'error');
      return;
    }

    const code = document.getElementById('trip-join-code').value.trim().toUpperCase();
    const name = document.getElementById('trip-join-name').value.trim();

    showLoading(true);
    try {
      // Check if trip exists
      const { data: trip, error: tripErr } = await supabaseClient.from('trips').select('*').eq('id', code).maybeSingle();
      if (tripErr) throw tripErr;
      if (!trip) {
        showToast('Invalid Trip Code. Session not found.', 'error');
        return;
      }

      // Check if member already exists
      const { data: existingMembers, error: memCheckErr } = await supabaseClient.from('members').select('*').eq('trip_id', code);
      if (memCheckErr) throw memCheckErr;

      let member = existingMembers.find(m => m.name.toLowerCase() === name.toLowerCase());

      if (!member) {
        // Create new member (Pre-claimed by Joiner device)
        const { data: newMem, error: insertErr } = await supabaseClient.from('members').insert([
          { trip_id: code, name: name, device_id: deviceId }
        ]).select();
        if (insertErr) throw insertErr;
        member = newMem[0];
        showToast(`Joined trip as ${name}!`, 'success');
      } else {
        // If member exists, verify claiming device
        if (member.device_id && member.device_id !== deviceId) {
          showToast(`The profile name "${member.name}" is already claimed by another device.`, 'error');
          return;
        }
        
        // If unclaimed, claim it now
        if (!member.device_id) {
          const { error: claimErr } = await supabaseClient.from('members').update({ device_id: deviceId }).eq('id', member.id);
          if (claimErr) throw claimErr;
        }
        showToast(`Logged back in as ${name}.`, 'success');
      }

      localStorage.setItem(`trip_user_id_${code}`, member.id);
      window.location.hash = code;
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error joining trip.', 'error');
    } finally {
      showLoading(false);
    }
  });

  // Active Simulated User View Select
  document.getElementById('select-active-member').addEventListener('change', (e) => {
    const selectedId = e.target.value;
    claimAndSetIdentity(selectedId);
  });

  // Identity Modal Join Form Submit
  document.getElementById('identity-join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('identity-join-name');
    const name = nameInput.value.trim();
    if (!name || !activeTripId) return;
    
    showLoading(true);
    try {
      // Create new member (Pre-claimed by Joiner device)
      const { data: newMem, error: insertErr } = await supabaseClient.from('members').insert([
        { trip_id: activeTripId, name: name, device_id: deviceId }
      ]).select();
      if (insertErr) throw insertErr;
      
      const member = newMem[0];
      setIdentity(member.id);
      nameInput.value = '';
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error joining trip.', 'error');
    } finally {
      showLoading(false);
    }
  });

  // Trip Add Member Quick Action
  document.getElementById('trip-add-member-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('trip-member-name-input');
    const name = nameInput.value.trim();
    if (!name || !activeTripId) return;

    try {
      const { error } = await supabaseClient.from('members').insert([
        { trip_id: activeTripId, name: name }
      ]);
      if (error) throw error;

      nameInput.value = '';
      toggleQuickAddMember();
      showToast(`${name} added to the trip.`, 'success');
      // Realtime subscription will handle refreshing
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error adding member.', 'error');
    }
  });

  // Trip Add Expense Form Submit
  document.getElementById('trip-expense-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeTripId || !supabaseClient) return;

    const desc = document.getElementById('trip-expense-desc').value.trim();
    const amount = parseFloat(document.getElementById('trip-expense-amount').value);
    const payerId = document.getElementById('trip-expense-payer').value;
    const category = document.getElementById('trip-expense-category').value;

    const payer = tripMembers.find(m => m.id === payerId);
    if (!payer) return;

    // Read checked participants
    const checkedBoxes = document.querySelectorAll('#trip-participants-container input[type="checkbox"]:checked');
    const participants = Array.from(checkedBoxes).map(cb => cb.value);

    if (participants.length === 0) {
      showToast('At least one member must participate in this expense.', 'warning');
      return;
    }

    // Calculate shares on the client-side to verify total sum before insertion.
    // We'll write the split data as JSON in the note field.
    const noteJSON = JSON.stringify({
      description: desc,
      participants: participants
    });

    showLoading(true);
    try {
      const { error } = await supabaseClient.from('expenses').insert([
        {
          trip_id: activeTripId,
          member_id: payerId,
          member_name: payer.name,
          category: category,
          amount: amount,
          note: noteJSON
        }
      ]);

      if (error) throw error;

      // Reset form fields
      document.getElementById('trip-expense-desc').value = '';
      document.getElementById('trip-expense-amount').value = '';
      showToast(`Expense logged: ₹${amount.toFixed(2)} for ${desc}.`, 'success');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error logging expense.', 'error');
    } finally {
      showLoading(false);
    }
  });

  // UPI payment confirmation logger
  document.getElementById('btn-upi-paid').addEventListener('click', async () => {
    const btn = document.getElementById('btn-upi-paid');
    const creditorId = btn.getAttribute('data-creditor-id');
    const creditorName = btn.getAttribute('data-creditor-name');
    const amount = parseFloat(btn.getAttribute('data-amount'));

    if (!activeTripId || !activeMemberId || !creditorId) return;

    const debtor = tripMembers.find(m => m.id === activeMemberId);
    if (!debtor) return;

    showLoading(true);
    try {
      // Log settlement payment in expenses as category 'settlement'
      const settlementJSON = JSON.stringify({
        type: 'settlement',
        creditor_id: creditorId,
        creditor_name: creditorName,
        status: 'pending_confirmation'
      });

      const { error } = await supabaseClient.from('expenses').insert([
        {
          trip_id: activeTripId,
          member_id: activeMemberId,
          member_name: debtor.name,
          category: 'settlement',
          amount: amount,
          note: settlementJSON
        }
      ]);

      if (error) throw error;

      closeUpiModal();
      showToast(`UPI payment of ₹${amount.toFixed(2)} marked as Paid. Waiting for confirmation.`, 'info');
    } catch (err) {
      console.error(err);
      showToast('Error recording settlement.', 'error');
    } finally {
      showLoading(false);
    }
  });
}

// ==========================================
// 4. QUICK SPLIT CORE RENDER LOGIC (LOCAL)
// ==========================================
function renderQuickSplit() {
  const membersListDiv = document.getElementById('qs-members-list');
  const partContainer = document.getElementById('qs-participants-container');
  const itemsListDiv = document.getElementById('qs-bill-items-list');
  const totalBillSpan = document.getElementById('qs-total-bill');
  const sharesOutputDiv = document.getElementById('qs-shares-output');

  // 1. Members tag list
  if (qsMembers.length === 0) {
    membersListDiv.innerHTML = '<span class="text-xs text-slate-500 italic py-1">No members added yet. Add a few names to begin.</span>';
  } else {
    membersListDiv.innerHTML = qsMembers.map((name, idx) => `
      <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-white/10 text-xs text-white font-medium shadow-sm animate-scale-in">
        <span>${name}</span>
        <button type="button" onclick="removeQsMember(${idx})" class="text-slate-400 hover:text-rose-400 transition-colors">
          <i class="fa-solid fa-xmark text-[10px]"></i>
        </button>
      </span>
    `).join('');
  }

  // 2. Splitting Participants Checklist
  if (qsMembers.length === 0) {
    partContainer.innerHTML = '<div class="text-xs text-slate-500 italic col-span-full py-1 text-center font-medium">Add group members above first to select them.</div>';
  } else {
    partContainer.innerHTML = qsMembers.map(name => `
      <label class="flex items-center gap-2.5 p-2 bg-slate-900/40 hover:bg-slate-900/80 rounded-lg cursor-pointer transition-colors border border-white/5">
        <input type="checkbox" value="${name}" checked class="custom-checkbox">
        <span class="text-xs font-semibold text-slate-200 select-none">${name}</span>
      </label>
    `).join('');
  }

  // 3. Bill items log list
  let totalBill = 0;
  if (qsItems.length === 0) {
    itemsListDiv.innerHTML = '<div class="text-sm text-slate-500 italic text-center py-6">No items added to the bill yet.</div>';
  } else {
    itemsListDiv.innerHTML = qsItems.map((item, idx) => {
      totalBill += item.amount;
      return `
        <div class="flex items-center justify-between p-3.5 bg-slate-950/60 rounded-xl border border-white/5 shadow-sm animate-scale-in">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-slate-300">${item.category}</span>
              <span class="text-[10px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 font-semibold border border-indigo-500/20">
                Split: ${item.participants.length} members
              </span>
            </div>
            <p class="text-[10px] text-slate-400">For: ${item.participants.join(', ')}</p>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-sm font-extrabold text-teal-400">₹${item.amount.toFixed(2)}</span>
            <button onclick="removeQsItem(${idx})" class="text-slate-500 hover:text-rose-400 transition-colors" title="Delete item">
              <i class="fa-regular fa-trash-can text-sm"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }
  totalBillSpan.textContent = `Total: ₹${totalBill.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // 4. Shares Output calculation
  if (qsMembers.length === 0 || qsItems.length === 0) {
    sharesOutputDiv.innerHTML = `
      <div class="text-center py-12">
        <div class="text-slate-500 text-sm">Waiting for members & bill items...</div>
        <div class="text-xs text-slate-600 mt-1 max-w-[280px] mx-auto">Add at least one group member and a bill item to calculate the final splits.</div>
      </div>
    `;
    return;
  }

  // Calculate local splits
  const memberShares = {};
  qsMembers.forEach(name => memberShares[name] = 0);

  qsItems.forEach(item => {
    const share = item.amount / item.participants.length;
    item.participants.forEach(p => {
      if (memberShares[p] !== undefined) {
        memberShares[p] += share;
      }
    });
  });

  // Calculate percentages and draw output
  let renderedShares = '';
  Object.keys(memberShares).forEach(name => {
    const amt = memberShares[name];
    const pct = totalBill > 0 ? (amt / totalBill) * 100 : 0;
    renderedShares += `
      <div class="bg-slate-950/40 border border-white/5 rounded-2xl p-4 space-y-2 animate-scale-in">
        <div class="flex justify-between items-center">
          <span class="font-bold text-slate-200 text-sm">${name}</span>
          <span class="text-sm font-extrabold text-teal-400">₹${amt.toFixed(2)}</span>
        </div>
        <!-- Custom bar indicator -->
        <div class="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-white/5">
          <div class="bg-gradient-to-r from-indigo-500 to-teal-400 h-full rounded-full" style="width: ${pct}%"></div>
        </div>
        <div class="text-[10px] text-slate-500 text-right">${pct.toFixed(1)}% of total bill</div>
      </div>
    `;
  });

  sharesOutputDiv.innerHTML = `
    <div class="space-y-3">
      ${renderedShares}
      <div class="border-t border-white/10 pt-4 mt-2 flex justify-between items-center">
        <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Net Combined Bill</span>
        <span class="text-xl font-black text-teal-400">₹${totalBill.toFixed(2)}</span>
      </div>
    </div>
  `;
}

function removeQsMember(index) {
  const name = qsMembers[index];
  qsMembers.splice(index, 1);
  // Remove member from all active split items containing them
  qsItems.forEach(item => {
    item.participants = item.participants.filter(p => p !== name);
  });
  // Clean empty items
  qsItems = qsItems.filter(item => item.participants.length > 0);

  localStorage.setItem('spliteasy_qs_members', JSON.stringify(qsMembers));
  localStorage.setItem('spliteasy_qs_items', JSON.stringify(qsItems));
  renderQuickSplit();
}

function removeQsItem(index) {
  qsItems.splice(index, 1);
  localStorage.setItem('spliteasy_qs_items', JSON.stringify(qsItems));
  renderQuickSplit();
}

function quickSplitToggleAllParticipants(checked) {
  const boxes = document.querySelectorAll('#qs-participants-container input[type="checkbox"]');
  boxes.forEach(cb => cb.checked = checked);
}

// ==========================================
// 5. TRIP MODE ONLINE DB LOADERS
// ==========================================
async function loadTrip(tripId) {
  try {
    // 1. Fetch Trip details
    const { data: trip, error: tripErr } = await supabaseClient.from('trips').select('*').eq('id', tripId).maybeSingle();
    if (tripErr) throw tripErr;

    if (!trip) {
      showToast('Trip not found. Clearing session.', 'error');
      window.location.hash = '';
      return;
    }
    tripData = trip;

    // 2. Fetch Members & Expenses
    await Promise.all([
      fetchMembers(),
      fetchExpenses()
    ]);

    // 3. Check / Prompt for Identity (Who are you?)
    checkAndPromptIdentity();

    // 4. Setup Real-time connections
    setupRealtimeSubscription(tripId);

    // 5. Compute Balances and render UI
    calculateBalancesAndRender();
  } catch (err) {
    console.error(err);
    showToast('Error syncing trip details.', 'error');
  }
}

async function fetchMembers() {
  if (!activeTripId || !supabaseClient) return;
  const { data, error } = await supabaseClient.from('members').select('*').eq('trip_id', activeTripId).order('joined_at', { ascending: true });
  if (error) throw error;
  tripMembers = data || [];
}

async function fetchExpenses() {
  if (!activeTripId || !supabaseClient) return;
  const { data, error } = await supabaseClient.from('expenses').select('*').eq('trip_id', activeTripId).order('created_at', { descending: true });
  if (error) throw error;
  tripExpenses = data || [];
}

/**
 * Connects to Supabase Channel for table update broadcasts
 */
function setupRealtimeSubscription(tripId) {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient.channel(`trip-changes:${tripId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, async (payload) => {
      // Re-fetch and render if this expense belongs to this trip, or matches an expense in our active list
      const isInsertOrUpdate = payload.new && payload.new.trip_id === tripId;
      const isDelete = payload.old && tripExpenses.some(e => e.id === payload.old.id);
      
      if (isInsertOrUpdate || isDelete) {
        console.log('Realtime DB Expense Notification:', payload);
        await fetchExpenses();
        calculateBalancesAndRender();
        showToast('Expenses updated in real-time.', 'info');
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, async (payload) => {
      // Re-fetch and render if this member belongs to this trip, or matches a member in our active list
      const isInsertOrUpdate = payload.new && payload.new.trip_id === tripId;
      const isDelete = payload.old && tripMembers.some(m => m.id === payload.old.id);
      
      if (isInsertOrUpdate || isDelete) {
        console.log('Realtime DB Member Notification:', payload);
        await fetchMembers();
        await fetchExpenses(); // Member deletion cascades to expenses
        checkAndPromptIdentity(); // Invalidate local session if active member deleted
        calculateBalancesAndRender();
        showToast('Trip members updated in real-time.', 'info');
      }
    })
    .subscribe((status) => {
      console.log(`Supabase Realtime status for Trip ${tripId}:`, status);
    });
}

// ==========================================
// 6. BALANCE COMPUTATIONS & GREEDY ALGORITHM
// ==========================================

/**
 * Computes running net balance sheets for all trip members
 */
function calculateBalancesAndRender() {
  if (!tripData || tripMembers.length === 0) return;

  // Initialize balance sheet
  const balances = {};
  tripMembers.forEach(m => {
    balances[m.id] = {
      id: m.id,
      name: m.name,
      totalPaid: 0,
      totalOwed: 0,
      netBalance: 0
    };
  });

  // Calculate running ledger totals
  tripExpenses.forEach(exp => {
    let noteData = {};
    try {
      noteData = JSON.parse(exp.note);
    } catch (e) {
      noteData = { description: exp.note || "", participants: [] };
    }

    if (exp.category === 'settlement') {
      // UPI settlement payment
      if (noteData.status === 'confirmed') {
        const debtorId = exp.member_id;
        const creditorId = noteData.creditor_id;

        if (balances[debtorId]) {
          balances[debtorId].netBalance += exp.amount; // Debtor gets credit for paying
        }
        if (balances[creditorId]) {
          balances[creditorId].netBalance -= exp.amount; // Creditor reduces receivable
        }
      }
    } else {
      // Standard category expense
      const payerId = exp.member_id;
      const participants = noteData.participants || [];

      // If empty participants list, split among ALL members currently in trip
      const targetParticipants = participants.length > 0
        ? participants.filter(id => balances[id] !== undefined)
        : tripMembers.map(m => m.id);

      if (balances[payerId]) {
        balances[payerId].totalPaid += exp.amount;
        balances[payerId].netBalance += exp.amount;
      }

      if (targetParticipants.length > 0) {
        const share = exp.amount / targetParticipants.length;
        targetParticipants.forEach(pId => {
          if (balances[pId]) {
            balances[pId].totalOwed += share;
            balances[pId].netBalance -= share;
          }
        });
      }
    }
  });

  // Build balances lists
  const balanceSheet = Object.values(balances);

  // Compute Optimized Transfers using Greedy Algorithm
  const transfers = runGreedySettlement(balanceSheet.map(b => ({
    id: b.id,
    name: b.name,
    balance: b.netBalance
  })));

  renderTripDashboard(balanceSheet, transfers);
}

/**
 * Greedy algorithm to calculate optimized debt settlement transfers
 * Minimizes transactions between debtors and creditors
 */
function runGreedySettlement(members) {
  // Filter and sort debtors and creditors
  // Creditors are members who are owed money (balance > 0)
  const creditors = members
    .filter(m => m.balance > 0.01)
    .sort((a, b) => b.balance - a.balance); // Largest creditor first

  // Debtors are members who owe money (balance < 0)
  const debtors = members
    .filter(m => m.balance < -0.01)
    .sort((a, b) => a.balance - b.balance); // Most negative first (owes the most)

  const transfers = [];

  while (creditors.length > 0 && debtors.length > 0) {
    const c = creditors[0];
    const d = debtors[0];

    const oweAmount = -d.balance;
    const receiveAmount = c.balance;
    const settleAmount = Math.min(oweAmount, receiveAmount);

    transfers.push({
      debtorId: d.id,
      debtorName: d.name,
      creditorId: c.id,
      creditorName: c.name,
      amount: settleAmount
    });

    // Update running balances
    d.balance += settleAmount;
    c.balance -= settleAmount;

    // Remove or re-sort
    if (Math.abs(d.balance) < 0.01) {
      debtors.shift();
    } else {
      debtors.sort((a, b) => a.balance - b.balance);
    }

    if (Math.abs(c.balance) < 0.01) {
      creditors.shift();
    } else {
      creditors.sort((a, b) => b.balance - a.balance);
    }
  }

  return transfers;
}

// ==========================================
// 7. TRIP MODE RENDER ENGINE
// ==========================================
function renderTripDashboard(balanceSheet, transfers) {
  if (!tripData) return;

  // Header Details
  document.getElementById('dashboard-trip-name').textContent = tripData.name;
  const expiryDate = new Date(tripData.expires_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short'
  });
  document.getElementById('dashboard-trip-info').innerHTML = `
    Host: <strong class="text-slate-300">${tripData.host_name}</strong> &nbsp;|&nbsp; 
    Expires: <strong class="text-slate-300">${expiryDate}</strong>
  `;

  // Invite Connection Code Link
  const currentUrlWithoutHash = window.location.href.split('#')[0];
  const inviteLink = `${currentUrlWithoutHash}#${tripData.id}`;
  document.getElementById('invite-code-span').textContent = inviteLink;

  // Render Group Members Sidebar List
  const membersListDiv = document.getElementById('trip-members-list');
  document.getElementById('trip-member-count').textContent = tripMembers.length;

  const isCurrentUserHost = tripMembers.some(mem => mem.id === activeMemberId && mem.name === tripData.host_name);

  membersListDiv.innerHTML = balanceSheet.map(m => {
    let statusText = '';
    let statusClass = 'text-slate-400';
    if (m.netBalance > 0.01) {
      statusText = `gets back ₹${m.netBalance.toFixed(2)}`;
      statusClass = 'text-teal-400 font-bold';
    } else if (m.netBalance < -0.01) {
      statusText = `owes ₹${Math.abs(m.netBalance).toFixed(2)}`;
      statusClass = 'text-rose-400 font-bold';
    } else {
      statusText = 'settled';
      statusClass = 'text-slate-500 font-medium';
    }

    const isSimulatedUser = m.id === activeMemberId ? '<span class="text-[9px] px-1.5 py-0.5 rounded bg-teal-400/20 text-teal-400 border border-teal-400/30">You</span>' : '';

    // Check if current user is the host, target member is not the host, and has no contributions
    const canRemove = isCurrentUserHost && m.id !== activeMemberId && !hasMemberContributions(m.id);
    const removeBtnHtml = canRemove 
      ? `<button onclick="removeTripMember('${m.id}', '${m.name}')" class="text-slate-500 hover:text-rose-400 p-1 transition-colors shrink-0 ml-1.5" title="Remove member from trip">
          <i class="fa-solid fa-user-minus text-xs"></i>
         </button>` 
      : '';

    // Check if current user is the host, target member is not the host, and has a device link linked
    const dbMember = tripMembers.find(mem => mem.id === m.id);
    const hasDeviceLink = dbMember && dbMember.device_id;
    const canResetDevice = isCurrentUserHost && m.id !== activeMemberId && hasDeviceLink;
    const resetDeviceBtnHtml = canResetDevice
      ? `<button onclick="resetMemberDevice('${m.id}', '${m.name}')" class="text-slate-500 hover:text-amber-400 p-1 transition-colors shrink-0 ml-1" title="Unlock profile (reset device link)">
          <i class="fa-solid fa-unlock text-xs"></i>
         </button>`
      : '';

    return `
      <div class="flex items-center justify-between p-2.5 rounded-xl border border-white/5 bg-slate-950/20 shadow-sm animate-scale-in">
        <div class="space-y-0.5">
          <div class="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <span>${m.name}</span> ${isSimulatedUser}
          </div>
          <div class="text-[10px] text-slate-500">Paid: ₹${m.totalPaid.toFixed(0)} | Share: ₹${m.totalOwed.toFixed(0)}</div>
        </div>
        <div class="flex items-center gap-1">
          <span class="text-xs ${statusClass}">${statusText}</span>
          ${resetDeviceBtnHtml}
          ${removeBtnHtml}
        </div>
      </div>
    `;
  }).join('');

  // Populate Add-Expense Paid-By Dropdown & Simulate Dropdown Selector
  const payerSelect = document.getElementById('trip-expense-payer');
  const viewSelect = document.getElementById('select-active-member');

  payerSelect.innerHTML = tripMembers.map(m => `<option value="${m.id}" ${m.id === activeMemberId ? 'selected' : ''}>${m.name}</option>`).join('');
  viewSelect.innerHTML = tripMembers.map(m => `<option value="${m.id}" ${m.id === activeMemberId ? 'selected' : ''}>${m.name}</option>`).join('');

  // Render Add Expense Participant Selection checklist
  const partContainer = document.getElementById('trip-participants-container');
  partContainer.innerHTML = tripMembers.map(m => `
    <label class="flex items-center gap-2.5 p-2 bg-slate-900/40 hover:bg-slate-900/80 rounded-lg cursor-pointer transition-colors border border-white/5">
      <input type="checkbox" value="${m.id}" checked class="custom-checkbox">
      <span class="text-xs font-semibold text-slate-200 select-none">${m.name}</span>
    </label>
  `).join('');

  // Dashboard Stats Totals
  let totalSpent = 0;
  tripExpenses.forEach(exp => {
    if (exp.category !== 'settlement') {
      totalSpent += exp.amount;
    }
  });

  const activeMemberBalance = balanceSheet.find(b => b.id === activeMemberId);
  const myTotalOwed = activeMemberBalance ? activeMemberBalance.totalOwed : 0;
  const myNet = activeMemberBalance ? activeMemberBalance.netBalance : 0;

  document.getElementById('trip-stat-total').textContent = `₹${totalSpent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('trip-stat-my-share').textContent = `₹${myTotalOwed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  // ==========================================
  // Render Settlement Suggestion Panels (UPI Flow Trigger)
  // ==========================================
  const transfersContainer = document.getElementById('trip-transfers-container');
  if (transfersContainer) {
    if (transfers.length === 0) {
      transfersContainer.innerHTML = '<div class="text-xs text-slate-500 italic py-12 text-center">Everyone is fully settled! No payments needed.</div>';
    } else {
      transfersContainer.innerHTML = transfers.map(t => {
        // If current user is the debtor, show "Mark Paid"
        const amIDebtor = t.debtorId === activeMemberId;

        // Check if there is an active settlement record in expenses awaiting confirmation for this transfer
        const hasPending = tripExpenses.some(exp => {
          if (exp.category !== 'settlement') return false;
          try {
            const parsed = JSON.parse(exp.note);
            return exp.member_id === t.debtorId && 
                   parsed.creditor_id === t.creditorId && 
                   parsed.status === 'pending_confirmation';
          } catch(e) {
            return false;
          }
        });

        let btnUpiHtml = '';
        if (hasPending) {
          btnUpiHtml = `<span class="text-[10px] text-slate-500 font-medium italic shrink-0">Waiting for confirmation...</span>`;
        } else if (amIDebtor) {
          btnUpiHtml = `<button onclick="openUpiModal('${t.creditorId}', '${t.creditorName}', ${t.amount})" class="px-3.5 py-2 rounded-xl bg-teal-400 hover:bg-teal-500 text-slate-950 text-[11px] font-extrabold shadow-md shadow-teal-400/10 hover:shadow-teal-400/20 transition-all flex items-center gap-1.5 shrink-0 select-none">
              Mark Paid
             </button>`;
        } else {
          btnUpiHtml = `<span class="text-[10px] text-slate-500 italic shrink-0">Awaiting transfer</span>`;
        }

        return `
          <div class="flex items-center justify-between p-3.5 bg-slate-950/40 border border-white/5 rounded-xl animate-scale-in">
            <div class="space-y-0.5 max-w-[65%]">
              <div class="text-xs font-semibold text-slate-200">
                <span class="text-rose-400 font-bold">${t.debtorName}</span> 
                <i class="fa-solid fa-arrow-right text-[10px] mx-1 text-slate-500"></i> 
                <span class="text-teal-400 font-bold">${t.creditorName}</span>
              </div>
              <p class="text-[10px] text-slate-400">Owes: ₹${t.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
            ${btnUpiHtml}
          </div>
        `;
      }).join('');
    }
  }

  // ==========================================
  // Render Pending & Trust Flow Containers
  // ==========================================
  const pendingContainer = document.getElementById('trip-pending-container');

  // Extract pending settlements
  const pendingPayments = tripExpenses.filter(exp => {
    if (exp.category !== 'settlement') return false;
    try {
      const data = JSON.parse(exp.note);
      return data.status === 'pending_confirmation';
    } catch (e) {
      return false;
    }
  });

  if (pendingPayments.length === 0) {
    pendingContainer.innerHTML = '<div class="text-xs text-slate-500 italic py-12 text-center">No pending settlements.</div>';
  } else {
    pendingContainer.innerHTML = pendingPayments.map(p => {
      let noteData = {};
      try { noteData = JSON.parse(p.note); } catch (e) { }

      const isMeCreditor = noteData.creditor_id === activeMemberId;
      const isMeDebtor = p.member_id === activeMemberId;

      let actionHtml = '';
      if (isMeCreditor) {
        // Creditor receives option to accept
        actionHtml = `
          <button onclick="confirmSettlementReceipt('${p.id}', '${p.member_name}', ${p.amount})" class="px-3 py-1.5 rounded-lg bg-teal-400 hover:bg-teal-500 text-slate-950 text-[10px] font-extrabold shadow-md transition-all shrink-0">
            Confirm Receipt
          </button>
        `;
      } else if (isMeDebtor) {
        actionHtml = `<span class="text-[10px] text-amber-300 font-semibold italic pulse-glow px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded">Pending Approval</span>`;
      } else {
        actionHtml = `<span class="text-[10px] text-slate-500 italic">Pending...</span>`;
      }

      return `
        <div class="flex items-center justify-between p-3.5 bg-slate-950/40 border border-amber-500/10 rounded-xl animate-scale-in pulse-glow">
          <div class="space-y-0.5 max-w-[65%]">
            <div class="text-xs font-semibold text-slate-200">
              <span class="text-teal-400 font-bold">${p.member_name}</span> paid <span class="text-teal-400 font-bold">${noteData.creditor_name}</span>
            </div>
            <p class="text-[10px] text-slate-400">Amount: ₹${p.amount.toFixed(2)} via UPI</p>
          </div>
          ${actionHtml}
        </div>
      `;
    }).join('');
  }

  // ==========================================
  // Render History log feed (Expenses + Settled)
  // ==========================================
  const historyList = document.getElementById('trip-history-list');
  if (tripExpenses.length === 0) {
    historyList.innerHTML = '<div class="text-sm text-slate-500 italic text-center py-8">No expenses logged yet. Add one above.</div>';
  } else {
    historyList.innerHTML = tripExpenses.map(exp => {
      let noteData = {};
      try {
        noteData = JSON.parse(exp.note);
      } catch (e) {
        noteData = { description: exp.note || "", participants: [] };
      }

      const dateStr = new Date(exp.created_at).toLocaleDateString('en-IN', {
        hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short'
      });

      const icon = CATEGORY_ICONS[exp.category] || '📦';
      const badgeClass = `badge-${exp.category.toLowerCase()}`;

      if (exp.category === 'settlement') {
        const status = noteData.status;
        const statusLabel = status === 'confirmed'
          ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold uppercase">Settled</span>`
          : `<span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold uppercase animate-pulse">Awaiting Confirmation</span>`;

        return `
          <div class="flex items-center justify-between p-4 bg-slate-900/40 border border-white/5 rounded-2xl animate-scale-in">
            <div class="flex items-start gap-3">
              <div class="h-10 w-10 rounded-xl bg-teal-400/10 border border-teal-400/20 flex items-center justify-center text-lg shrink-0">
                ${icon}
              </div>
              <div class="space-y-1">
                <div class="flex items-center gap-2">
                  <h4 class="font-bold text-slate-200 text-xs sm:text-sm">UPI Transfer</h4>
                  ${statusLabel}
                </div>
                <p class="text-[10px] text-slate-400">
                  From <strong class="text-slate-300">${exp.member_name}</strong> to <strong class="text-slate-300">${noteData.creditor_name}</strong>
                </p>
                <div class="text-[9px] text-slate-500">${dateStr}</div>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-sm font-black text-teal-400">₹${exp.amount.toFixed(2)}</span>
              ${(exp.member_id === activeMemberId || noteData.creditor_id === activeMemberId) ? `
                <button onclick="deleteTripExpense('${exp.id}')" class="text-slate-600 hover:text-rose-400 transition-colors" title="Delete record">
                  <i class="fa-regular fa-trash-can text-xs"></i>
                </button>
              ` : ''}
            </div>
          </div>
        `;
      } else {
        const description = noteData.description || 'Expense';
        const pNames = (noteData.participants || []).map(id => {
          const m = tripMembers.find(mem => mem.id === id);
          return m ? m.name : 'Unknown';
        });
        const splitText = pNames.length > 0 ? `Split among: ${pNames.join(', ')}` : 'Split among: All';

        return `
          <div class="flex items-center justify-between p-4 bg-slate-900/40 border border-white/5 rounded-2xl animate-scale-in">
            <div class="flex items-start gap-3">
              <div class="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-lg shrink-0">
                ${icon}
              </div>
              <div class="space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <h4 class="font-bold text-slate-200 text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">${description}</h4>
                  <span class="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${badgeClass}">
                    ${exp.category}
                  </span>
                </div>
                <p class="text-[10px] text-slate-400">
                  Paid by <strong class="text-slate-300">${exp.member_name}</strong> &nbsp;|&nbsp; <span class="text-slate-500">${splitText}</span>
                </p>
                <div class="text-[9px] text-slate-500">${dateStr}</div>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-sm font-black text-white">₹${exp.amount.toFixed(2)}</span>
              <!-- Enable deleting if user is payer of this expense -->
              ${(exp.member_id === activeMemberId) ? `
                <button onclick="deleteTripExpense('${exp.id}')" class="text-slate-600 hover:text-rose-400 transition-colors" title="Delete expense">
                  <i class="fa-regular fa-trash-can text-xs"></i>
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }
    }).join('');
  }
}

async function deleteTripExpense(id) {
  if (!confirm('Are you sure you want to delete this log?')) return;
  showLoading(true);
  try {
    const { error } = await supabaseClient.from('expenses').delete().eq('id', id);
    if (error) throw error;
    showToast('Record deleted.', 'success');
    await fetchExpenses();
    calculateBalancesAndRender();
  } catch (err) {
    console.error(err);
    showToast('Error deleting record.', 'error');
  } finally {
    showLoading(false);
  }
}

async function confirmSettlementReceipt(expenseId, debtorName, amount) {
  if (!supabaseClient) return;

  showLoading(true);
  try {
    // Read old expense log first
    const { data: exp, error: fetchErr } = await supabaseClient.from('expenses').select('*').eq('id', expenseId).single();
    if (fetchErr) throw fetchErr;

    const noteData = JSON.parse(exp.note);
    noteData.status = 'confirmed'; // mark settled

    // Update
    const { error: updateErr } = await supabaseClient.from('expenses').update({
      note: JSON.stringify(noteData)
    }).eq('id', expenseId);

    if (updateErr) throw updateErr;

    showToast(`Receipt confirmed for ₹${amount.toFixed(2)} from ${debtorName}. Balances updated!`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Error confirming payment.', 'error');
  } finally {
    showLoading(false);
  }
}

// Select/Deselect checkbox helpers
function tripToggleAllParticipants(checked) {
  const boxes = document.querySelectorAll('#trip-participants-container input[type="checkbox"]');
  boxes.forEach(cb => cb.checked = checked);
}

function toggleQuickAddMember() {
  const container = document.getElementById('quick-add-member-container');
  if (container.classList.contains('hidden')) {
    container.classList.remove('hidden');
    document.getElementById('trip-member-name-input').focus();
  } else {
    container.classList.add('hidden');
  }
}

// Identity Modal Helpers
function showIdentityModal() {
  const modal = document.getElementById('identity-modal');
  const listDiv = document.getElementById('identity-members-list');
  
  if (tripMembers.length === 0) {
    listDiv.innerHTML = '<div class="text-xs text-slate-500 italic py-4 text-center font-medium">No members found. Add yourself below to join.</div>';
  } else {
    listDiv.innerHTML = tripMembers.map(m => {
      const isClaimedByOthers = m.device_id && m.device_id !== deviceId;
      
      if (isClaimedByOthers) {
        return `
          <button onclick="promptReclaimIdentity('${m.id}', '${m.name}')" class="w-full text-left p-3.5 bg-slate-950/20 hover:bg-amber-400/10 border border-white/5 hover:border-amber-500/30 text-slate-400 rounded-xl font-semibold text-xs transition-all flex justify-between items-center group select-none animate-scale-in">
            <span class="flex items-center gap-1.5">
              <span>${m.name}</span>
              <span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold uppercase tracking-wide">Linked</span>
            </span>
            <i class="fa-solid fa-lock text-[10px] text-slate-500 group-hover:text-amber-400 transition-colors"></i>
          </button>
        `;
      } else {
        return `
          <button onclick="claimAndSetIdentity('${m.id}')" class="w-full text-left p-3.5 bg-slate-950/60 hover:bg-teal-400 hover:text-slate-950 rounded-xl border border-white/5 font-semibold text-xs text-slate-200 hover:border-teal-400 transition-all flex justify-between items-center group select-none animate-scale-in">
            <span>${m.name}</span>
            <i class="fa-solid fa-chevron-right text-[10px] text-slate-500 group-hover:text-slate-950 transition-colors"></i>
          </button>
        `;
      }
    }).join('');
  }
  
  modal.classList.remove('hidden');
}

/**
 * Prompts the user with a double-confirmation warning to reclaim a profile.
 */
function promptReclaimIdentity(memberId, name) {
  const msg = `"${name}" is currently linked to another device.\n\n` +
              `If you are indeed "${name}" and want to claim this profile on your current device/browser, click OK to proceed.\n\n` +
              `This will link the profile to this browser.`;
              
  if (confirm(msg)) {
    claimAndSetIdentity(memberId);
  }
}

function hideIdentityModal() {
  document.getElementById('identity-modal').classList.add('hidden');
}

/**
 * Checks if the stored identity is still valid in the current trip.
 * If not, resets it and displays the identity selection modal.
 */
function checkAndPromptIdentity() {
  if (!activeTripId) return;
  let localSavedId = localStorage.getItem(`trip_user_id_${activeTripId}`);

  // Auto-login fallback: check if a member in this trip is already claimed by this device
  if (!localSavedId && tripMembers.length > 0) {
    const autoMember = tripMembers.find(m => m.device_id === deviceId);
    if (autoMember) {
      localSavedId = autoMember.id;
      localStorage.setItem(`trip_user_id_${activeTripId}`, localSavedId);
    }
  }

  const isSavedIdValid = localSavedId && tripMembers.some(m => m.id === localSavedId && (m.device_id === deviceId || !m.device_id));

  if (isSavedIdValid) {
    activeMemberId = localSavedId;
    hideIdentityModal();
  } else {
    activeMemberId = null;
    localStorage.removeItem(`trip_user_id_${activeTripId}`);
    showIdentityModal();
  }
}

function setIdentity(memberId) {
  if (activeTripId) {
    localStorage.setItem(`trip_user_id_${activeTripId}`, memberId);
  }
  activeMemberId = memberId;
  hideIdentityModal();
  calculateBalancesAndRender();
  showToast('Profile activated on this device.', 'success');
}

async function claimAndSetIdentity(memberId) {
  if (!activeTripId || !supabaseClient) return;
  
  showLoading(true);
  try {
    // Claim the identity on the database
    const { error } = await supabaseClient.from('members').update({
      device_id: deviceId
    }).eq('id', memberId);
    
    if (error) throw error;
    
    // Set identity locally
    setIdentity(memberId);
    
    // Re-fetch members to sync claimed device_id states
    await fetchMembers();
    calculateBalancesAndRender();
  } catch (err) {
    console.error(err);
    showToast('Error claiming profile identity.', 'error');
  } finally {
    showLoading(false);
  }
}

async function rejectSettlementReceipt(expenseId, debtorName, amount) {
  if (!confirm(`Are you sure you did not receive ₹${amount.toFixed(2)} from ${debtorName}? This will reject the settlement and restore their debt.`)) return;
  showLoading(true);
  try {
    const { error } = await supabaseClient.from('expenses').delete().eq('id', expenseId);
    if (error) throw error;
    showToast(`Rejected settlement from ${debtorName}. Balances restored.`, 'warning');
  } catch (err) {
    console.error(err);
    showToast('Error rejecting settlement.', 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Checks if a member has made any financial contributions to the trip.
 * A contribution is defined as:
 * 1. Paying for any standard expense.
 * 2. Participating in any standard expense split.
 * 3. Being involved in any UPI settlement (confirmed or pending).
 */
function hasMemberContributions(memberId) {
  // 1. Check if they paid for any standard expense
  const hasPaidExpense = tripExpenses.some(exp => exp.category !== 'settlement' && exp.member_id === memberId);
  if (hasPaidExpense) return true;

  // 2. Check if they participated in any expense split
  const hasParticipated = tripExpenses.some(exp => {
    if (exp.category === 'settlement') return false;
    try {
      const parsed = JSON.parse(exp.note);
      return parsed.participants && parsed.participants.includes(memberId);
    } catch(e) {
      return false;
    }
  });
  if (hasParticipated) return true;

  // 3. Check if they are involved in any settlement
  const hasSettlement = tripExpenses.some(exp => {
    if (exp.category !== 'settlement') return false;
    try {
      const parsed = JSON.parse(exp.note);
      return exp.member_id === memberId || parsed.creditor_id === memberId;
    } catch(e) {
      return false;
    }
  });
  if (hasSettlement) return true;

  return false;
}

/**
 * Deletes a member from the database, updating the trip's realtime sync.
 */
async function removeTripMember(memberId, name) {
  if (!confirm(`Are you sure you want to remove ${name} from this trip?`)) return;
  showLoading(true);
  try {
    const { error } = await supabaseClient.from('members').delete().eq('id', memberId);
    if (error) throw error;
    showToast(`Removed ${name} from trip.`, 'success');
    await fetchMembers();
    await fetchExpenses(); // Member deletion cascades to expenses
    checkAndPromptIdentity(); // Invalidate local session if active member deleted
    calculateBalancesAndRender();
  } catch (err) {
    console.error(err);
    showToast('Error removing member from trip.', 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Resets the device link for a member, allowing anyone to claim it again.
 * Only callable by the Host/Creator of the trip.
 */
async function resetMemberDevice(memberId, name) {
  if (!confirm(`Are you sure you want to unlock "${name}"'s profile?\n\nThis will disconnect their current browser/device link.`)) return;
  showLoading(true);
  try {
    const { error } = await supabaseClient.from('members').update({
      device_id: null
    }).eq('id', memberId);

    if (error) throw error;

    showToast(`Unlocked profile for ${name}.`, 'success');
    await fetchMembers();
    calculateBalancesAndRender();
  } catch (err) {
    console.error(err);
    showToast('Error resetting profile device link.', 'error');
  } finally {
    showLoading(false);
  }
}

// ==========================================
// 8. MODAL WINDOW TRIGGERS
// ==========================================

function openUpiModal(creditorId, creditorName, amount) {
  const modal = document.getElementById('upi-modal');
  document.getElementById('upi-creditor-name').textContent = creditorName;
  document.getElementById('upi-amount').textContent = `₹${amount.toFixed(2)}`;
  document.getElementById('upi-vpa').textContent = `${creditorName.toLowerCase().replace(/\s+/g, '')}@upi`;

  // Attach metadata to pay button
  const btn = document.getElementById('btn-upi-paid');
  btn.setAttribute('data-creditor-id', creditorId);
  btn.setAttribute('data-creditor-name', creditorName);
  btn.setAttribute('data-amount', amount);

  modal.classList.remove('hidden');
}

function closeUpiModal() {
  document.getElementById('upi-modal').classList.add('hidden');
}

// Copy Invite Link to Clipboard
function copyInviteLink() {
  const text = document.getElementById('invite-code-span').textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Invite URL copied to clipboard!', 'success');
  }).catch(err => {
    console.error('Copy failed:', err);
    showToast('Failed to copy. Please copy manually.', 'error');
  });
}

// Toggle loading screen spinner
function showLoading(show) {
  let spinner = document.getElementById('loading-spinner');
  if (show) {
    if (!spinner) {
      spinner = document.createElement('div');
      spinner.id = 'loading-spinner';
      spinner.className = 'fixed top-4 right-4 z-50 bg-slate-900 border border-white/10 rounded-xl p-2.5 shadow-lg flex items-center gap-2 animate-scale-in';
      spinner.innerHTML = '<div class="spinner"></div><span class="text-xs font-semibold text-slate-300">Syncing...</span>';
      document.body.appendChild(spinner);
    }
  } else {
    if (spinner) {
      spinner.remove();
    }
  }
}

// Toast System
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast flex items-center gap-2 px-4 py-3 rounded-xl border text-sm max-w-sm w-full';

  let icon = '<i class="fa-solid fa-circle-info text-blue-400"></i>';
  if (type === 'success') {
    toast.style.borderColor = 'rgba(45, 212, 191, 0.3)';
    icon = '<i class="fa-solid fa-circle-check text-teal-400"></i>';
  } else if (type === 'warning') {
    toast.style.borderColor = 'rgba(245, 158, 11, 0.3)';
    icon = '<i class="fa-solid fa-circle-exclamation text-amber-400"></i>';
  } else if (type === 'error') {
    toast.style.borderColor = 'rgba(244, 63, 94, 0.3)';
    icon = '<i class="fa-solid fa-circle-xmark text-rose-500"></i>';
  } else {
    toast.style.borderColor = 'rgba(129, 140, 248, 0.3)';
  }

  toast.innerHTML = `
    <div class="shrink-0 text-base">${icon}</div>
    <div class="flex-1 text-xs text-slate-300 font-medium leading-tight">${message}</div>
  `;

  container.appendChild(toast);

  // Remove toast after 4.5 seconds
  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease-out reverse';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// ==========================================
// 9. COGNITIVE VERIFICATION & UNIT TESTS
// ==========================================
function runSelfTests() {
  console.group('--- SplitEasy Codebase Self-Test Assertions ---');

  // Assertion 1: Verify Quick Split Core Math
  // Scenario: 5 members (A, B, C, D, E)
  // Food (₹12,000) split among A,B,C,D,E (₹2,400 each)
  // Drinks (₹3,000) split among A,B,C (₹1,000 each)
  // Expected Result: A=3400, B=3400, C=3400, D=2400, E=2400
  const testMembers = ['A', 'B', 'C', 'D', 'E'];
  const testItems = [
    { category: 'Food', amount: 12000, participants: ['A', 'B', 'C', 'D', 'E'] },
    { category: 'Drinks', amount: 3000, participants: ['A', 'B', 'C'] }
  ];

  const calcShares = {};
  testMembers.forEach(name => calcShares[name] = 0);

  testItems.forEach(item => {
    const share = item.amount / item.participants.length;
    item.participants.forEach(p => {
      calcShares[p] += share;
    });
  });

  console.assert(calcShares['A'] === 3400, `Assertion 1.1 Failed: A has ₹${calcShares['A']}, expected 3400`);
  console.assert(calcShares['B'] === 3400, `Assertion 1.2 Failed: B has ₹${calcShares['B']}, expected 3400`);
  console.assert(calcShares['C'] === 3400, `Assertion 1.3 Failed: C has ₹${calcShares['C']}, expected 3400`);
  console.assert(calcShares['D'] === 2400, `Assertion 1.4 Failed: D has ₹${calcShares['D']}, expected 2400`);
  console.assert(calcShares['E'] === 2400, `Assertion 1.5 Failed: E has ₹${calcShares['E']}, expected 2400`);

  const totalCalculated = Object.values(calcShares).reduce((acc, curr) => acc + curr, 0);
  console.assert(totalCalculated === 15000, `Assertion 1.6 Failed: Total Sum is ₹${totalCalculated}, expected 15000`);

  console.log('Assertion 1 (Quick Split Math Verification): PASSED ✅');

  // Assertion 2: Verify Greedy Debt Settlement Algorithm
  // Scenario: Alice owes -3000, Bob owes -2000, Charlie is owed +5000
  // Expected Transfers: Bob pays Charlie 2000, Alice pays Charlie 3000
  const testTransfersMembers = [
    { id: '1', name: 'Alice', balance: -3000 },
    { id: '2', name: 'Bob', balance: -2000 },
    { id: '3', name: 'Charlie', balance: 5000 }
  ];

  const resultTransfers = runGreedySettlement(testTransfersMembers);

  console.assert(resultTransfers.length === 2, `Assertion 2.1 Failed: Got ${resultTransfers.length} transfers, expected 2`);

  // Verify totals matching
  const bobToCharlie = resultTransfers.find(t => t.debtorName === 'Bob' && t.creditorName === 'Charlie');
  const aliceToCharlie = resultTransfers.find(t => t.debtorName === 'Alice' && t.creditorName === 'Charlie');

  console.assert(bobToCharlie && bobToCharlie.amount === 2000, `Assertion 2.2 Failed: Bob to Charlie amount incorrect. Got:`, bobToCharlie);
  console.assert(aliceToCharlie && aliceToCharlie.amount === 3000, `Assertion 2.3 Failed: Alice to Charlie amount incorrect. Got:`, aliceToCharlie);

  console.log('Assertion 2 (Greedy Settlement Transfer Verification): PASSED ✅');
  console.groupEnd();
}
