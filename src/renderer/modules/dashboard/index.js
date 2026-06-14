const dashboardApi = window.dashboard;

export function initDashboard() {
let overlayActive = false;
const STREAKS_STORAGE_KEY = 'clarity:streaks';
const TASKS_STORAGE_KEY = 'clarity:tasks';
const XP_PER_LEVEL = 100;

function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getTodayKey() {
    return formatDateKey(new Date());
}

function getYesterdayKey() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return formatDateKey(date);
}

function getStreakState() {
    try {
        return {
            totalXp: 0,
            streak: 0,
            lastCheckIn: null,
            claimedQuests: {},
            ...JSON.parse(localStorage.getItem(STREAKS_STORAGE_KEY) || '{}')
        };
    } catch {
        localStorage.removeItem(STREAKS_STORAGE_KEY);
        return { totalXp: 0, streak: 0, lastCheckIn: null, claimedQuests: {} };
    }
}

function saveStreakState(state) {
    localStorage.setItem(STREAKS_STORAGE_KEY, JSON.stringify(state));
    renderStreaks();
}

function addXp(amount) {
    const state = getStreakState();
    state.totalXp = Math.max(0, Number(state.totalXp || 0) + amount);
    saveStreakState(state);
}

function claimQuestXp(quest, amount) {
    const state = getStreakState();
    const key = `${quest}:${getTodayKey()}`;
    state.claimedQuests ??= {};
    if (state.claimedQuests[key]) return;
    state.claimedQuests[key] = true;
    state.totalXp = Math.max(0, Number(state.totalXp || 0) + amount);
    saveStreakState(state);
}

function claimDailyXp() {
    const state = getStreakState();
    const today = getTodayKey();
    if (state.lastCheckIn === today) return;

    state.streak = state.lastCheckIn === getYesterdayKey()
        ? Number(state.streak || 0) + 1
        : 1;
    state.lastCheckIn = today;
    state.totalXp = Math.max(0, Number(state.totalXp || 0) + 25);
    saveStreakState(state);
}

function renderStreaks() {
    const state = getStreakState();
    const totalXp = Number(state.totalXp || 0);
    const level = Math.floor(totalXp / XP_PER_LEVEL) + 1;
    const levelXp = totalXp % XP_PER_LEVEL;
    const todayClaimed = state.lastCheckIn === getTodayKey();

    document.getElementById('xpLevel') && (document.getElementById('xpLevel').textContent = `Level ${level}`);
    document.getElementById('xpMeta') && (document.getElementById('xpMeta').textContent = `${levelXp} / ${XP_PER_LEVEL} XP`);
    document.getElementById('xpProgressFill') && (document.getElementById('xpProgressFill').style.width = `${levelXp}%`);
    document.getElementById('streakCount') && (document.getElementById('streakCount').textContent = Number(state.streak || 0));
    document.getElementById('streakLabel') && (document.getElementById('streakLabel').textContent = Number(state.streak || 0) === 1 ? 'day in a row' : 'days in a row');

    const checkInButton = document.getElementById('dailyCheckInButton');
    if (checkInButton) {
        checkInButton.textContent = todayClaimed ? 'Claimed' : 'Check In';
        checkInButton.disabled = todayClaimed;
    }
}

function getTasks() {
    try {
        const tasks = JSON.parse(localStorage.getItem(TASKS_STORAGE_KEY) || '[]');
        return Array.isArray(tasks) ? tasks : [];
    } catch {
        localStorage.removeItem(TASKS_STORAGE_KEY);
        return [];
    }
}

function saveTasks(tasks) {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
    renderTasks();
}

function addTask(event) {
    event.preventDefault();
    const input = document.getElementById('taskInput');
    const title = input.value.trim();
    if (!title) return;

    const tasks = getTasks();
    tasks.push({
        id: `${Date.now()}:${Math.random().toString(16).slice(2)}`,
        title,
        complete: false,
        createdAt: new Date().toISOString()
    });
    input.value = '';
    saveTasks(tasks);
}

function moveTask(id, direction) {
    const tasks = getTasks();
    const index = tasks.findIndex(task => task.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= tasks.length) return;

    [tasks[index], tasks[nextIndex]] = [tasks[nextIndex], tasks[index]];
    saveTasks(tasks);
}

function toggleTask(id) {
    const tasks = getTasks();
    const task = tasks.find(item => item.id === id);
    if (!task) return;

    task.complete = !task.complete;
    saveTasks(tasks);
}

function deleteTask(id) {
    saveTasks(getTasks().filter(task => task.id !== id));
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderTasks() {
    const taskList = document.getElementById('taskList');
    if (!taskList) return;

    const tasks = getTasks();
    if (!tasks.length) {
        taskList.innerHTML = '<div class="task-empty">No tasks yet. Add one to start prioritizing.</div>';
        return;
    }

    taskList.innerHTML = tasks.map((task, index) => `
        <div class="task-item ${task.complete ? 'is-complete' : ''}">
            <button class="task-check" onclick="toggleTask('${task.id}')" title="${task.complete ? 'Mark incomplete' : 'Mark complete'}">
                ${task.complete ? '<span class="material-symbols-outlined">done</span>' : ''}
            </button>
            <div>
                <div class="task-name">${escapeHtml(task.title)}</div>
                <div class="task-meta">Priority ${index + 1}</div>
            </div>
            <div class="task-actions">
                <button class="task-icon-btn" onclick="moveTask('${task.id}', -1)" title="Move up" ${index === 0 ? 'disabled' : ''}>
                    <span class="material-symbols-outlined">keyboard_arrow_up</span>
                </button>
                <button class="task-icon-btn" onclick="moveTask('${task.id}', 1)" title="Move down" ${index === tasks.length - 1 ? 'disabled' : ''}>
                    <span class="material-symbols-outlined">keyboard_arrow_down</span>
                </button>
                <button class="task-icon-btn" onclick="deleteTask('${task.id}')" title="Delete task">
                    <span class="material-symbols-outlined">delete</span>
                </button>
            </div>
        </div>
    `).join('');
}

function switchPage(page) {
    // Hide all pages
    document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
    
    // Show selected page
    document.getElementById(`page-${page}`).style.display = 'block';
    
    // Update title
    const titles = {
        dashboard: 'Dashboard',
        overlay: 'Overlay Controls',
        displays: 'Displays',
        chat: 'Chat Assistant',
        streaks: 'Streaks & XP',
        accessibility: 'Accessibility Settings'
    };
    document.getElementById('pageTitle').textContent = titles[page];
    if (page === 'streaks') renderStreaks();
    
    // Update active nav
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    event.target.closest('.nav-item').classList.add('active');
}

async function updateStatus() {
    try {
        const status = await dashboardApi.getOverlayStatus();
        overlayActive = status.active;
        updateUI();
    } catch (error) {
        console.error('Error getting status:', error);
        showError('Failed to get overlay status');
    }
}

function updateUI() {
    const toggle = document.getElementById('overlayToggle');
    const toggle2 = document.getElementById('overlayToggle2');
    const status = document.getElementById('overlayStatus');
    const status2 = document.getElementById('overlayStatus2');
    const buttonText = document.getElementById('overlayButtonText');

    if (overlayActive) {
        toggle?.classList.add('active');
        toggle2?.classList.add('active');
        status.classList.add('active');
        status2.classList.add('active');
        status.innerHTML = '<span class="status-dot"></span>Active';
        status2.innerHTML = '<span class="status-dot"></span>Active';
        buttonText.textContent = 'Stop Overlay';
    } else {
        toggle?.classList.remove('active');
        toggle2?.classList.remove('active');
        status.classList.remove('active');
        status2.classList.remove('active');
        status.innerHTML = '<span class="status-dot"></span>Inactive';
        status2.innerHTML = '<span class="status-dot"></span>Inactive';
        buttonText.textContent = 'Start Overlay';
    }
}

async function updateDisplayInfo() {
    try {
        const displays = await dashboardApi.getDisplays();
        
        const countText = `${displays.length} Display${displays.length !== 1 ? 's' : ''} Connected`;
        document.getElementById('displayCount').innerHTML = `<div style="color: #b0b0b0; font-size: 13px;">${countText}</div>`;
        document.getElementById('displayCountDetailed').textContent = countText;
        
        if (displays.length > 0) {
            const html = displays
                .map((d, i) => `
                    <div class="display-item">
                        <div>
                            <div class="display-name">Display ${i + 1}</div>
                            <div class="display-res">${d.bounds.width}×${d.bounds.height}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="color: #b223e3; font-weight: 600;">${d.scaleFactor}x</div>
                        </div>
                    </div>
                `).join('');
            document.getElementById('displayList').innerHTML = html;
            document.getElementById('displayListDetailed').innerHTML = html;
        } else {
            document.getElementById('displayList').innerHTML = '<div class="display-item">No displays detected</div>';
            document.getElementById('displayListDetailed').innerHTML = '<div class="display-item">No displays detected</div>';
        }
    } catch (error) {
        console.error('Error getting displays:', error);
        document.getElementById('displayCount').textContent = 'Display details unavailable';
        document.getElementById('displayCountDetailed').textContent = 'Display details unavailable';
    }
}

function showError(message) {
    const errorEl = document.getElementById('error');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    setTimeout(() => {
        errorEl.style.display = 'none';
    }, 5000);
}

async function toggleOverlay() {
    try {
        if (overlayActive) {
            await dashboardApi.hideOverlay();
        } else {
            await dashboardApi.showOverlay();
            claimQuestXp('overlay', 15);
        }
        await updateStatus();
    } catch (error) {
        console.error('Error toggling overlay:', error);
        showError('Failed to toggle overlay');
    }
}

function showChat() {
    dashboardApi.showChat();
    claimQuestXp('chat', 10);
}

function toggleAccessibilityFeature(feature, toggle) {
    toggle.classList.toggle('active');
    saveAccessibilityPreferences();
}

function getAccessibilityPreferencesFromUI() {
    const features = ['largeText', 'audio', 'magnify', 'screenReader', 'voiceControl', 'highContrast'];
    return features.reduce((preferences, feature) => {
        preferences[feature] = document
            .getElementById(`${feature}Toggle`)
            ?.classList.contains('active') ?? false;
        return preferences;
    }, {});
}

function renderAccessibilityPreferences(preferences = {}) {
    const features = ['largeText', 'audio', 'magnify', 'screenReader', 'voiceControl', 'highContrast'];

    features.forEach((feature) => {
        const toggle = document.getElementById(`${feature}Toggle`);
        const enabled = Boolean(preferences[feature]);
        toggle?.classList.toggle('active', enabled);
    });
}

async function saveAccessibilityPreferences() {
    const preferences = getAccessibilityPreferencesFromUI();
    localStorage.setItem('accessibility:preferences', JSON.stringify(preferences));
    try {
        await dashboardApi.setAccessibilityPreferences(preferences);
    } catch (error) {
        console.error('Error saving accessibility preferences:', error);
        showError('Failed to update overlay accessibility');
    }
}

async function loadAccessibilityPreferences() {
    const saved = localStorage.getItem('accessibility:preferences');
    let localPreferences = {};
    try {
        localPreferences = saved ? JSON.parse(saved) : {};
    } catch {
        localStorage.removeItem('accessibility:preferences');
    }
    renderAccessibilityPreferences(localPreferences);

    try {
        const current = await dashboardApi.getAccessibilityPreferences();
        const preferences = { ...current, ...localPreferences };
        renderAccessibilityPreferences(preferences);
        await dashboardApi.setAccessibilityPreferences(preferences);
    } catch (error) {
        console.error('Error loading accessibility preferences:', error);
    }
}

function showSettings() {
    alert('Settings coming soon!');
}

function quitApp() {
    if (confirm('Are you sure you want to quit Clarity?')) {
        dashboardApi.quitApp();
    }
}

function minimizeWindow() {
    dashboardApi.minimizeDashboard();
}

function closeWindow() {
    dashboardApi.closeDashboard();
}

// Listen for overlay state changes
dashboardApi.onOverlayStateChanged((state) => {
    overlayActive = state.active;
    updateUI();
});

dashboardApi.onAccessibilityPreferencesChanged?.((preferences) => {
    renderAccessibilityPreferences(preferences);
    localStorage.setItem('accessibility:preferences', JSON.stringify(preferences));
});

// Initial load
loadAccessibilityPreferences();
renderStreaks();
renderTasks();
updateStatus();
updateDisplayInfo();
setInterval(updateDisplayInfo, 3000);
}
