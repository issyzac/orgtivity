const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function ensureDbExists() {
  if (!fs.existsSync(DB_PATH)) {
    const parentDir = path.dirname(DB_PATH);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const defaultDb = {
      projects: [],
      users: [],
      rates: [],
      expenseCategories: [],
      activities: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDbExists();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(raw);
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  getProjects: () => readDb().projects || [],
  getUsers: () => readDb().users || [],
  getRates: () => readDb().rates || [],
  getExpenseCategories: () => readDb().expenseCategories || [],
  
  getActivities: () => readDb().activities || [],
  
  getActivity: (id) => {
    const activities = readDb().activities || [];
    return activities.find(act => act.id === id);
  },
  
  saveActivity: (activity) => {
    const db = readDb();
    const index = db.activities.findIndex(act => act.id === activity.id);
    if (index !== -1) {
      db.activities[index] = activity;
    } else {
      db.activities.push(activity);
    }
    writeDb(db);
    return activity;
  },

  deleteActivity: (id) => {
    const db = readDb();
    db.activities = db.activities.filter(act => act.id !== id);
    writeDb(db);
    return true;
  },

  addProject: (project) => {
    const db = readDb();
    db.projects.push(project);
    writeDb(db);
    return project;
  },

  addUser: (user) => {
    const db = readDb();
    db.users.push(user);
    writeDb(db);
    return user;
  },

  saveUser: (user) => {
    const db = readDb();
    const index = db.users.findIndex(u => u.id === user.id);
    if (index !== -1) {
      db.users[index] = user;
    } else {
      db.users.push(user);
    }
    writeDb(db);
    return user;
  },

  addRate: (rate) => {
    const db = readDb();
    db.rates.push(rate);
    writeDb(db);
    return rate;
  }
};
