const { MongoClient } = require("mongodb");

const DEFAULT_DB_NAME = "clarity";
const DEFAULT_COLLECTION_NAME = "chat_messages";
const MAX_HISTORY_MESSAGES = 100;

let client = null;
let db = null;

function getMongoUri() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri || uri.startsWith("your_")) return null;
  return uri;
}

function getDbName() {
  return process.env.MONGODB_DB?.trim() || DEFAULT_DB_NAME;
}

async function getDb() {
  if (db) return db;

  const uri = getMongoUri();
  if (!uri) {
    throw new Error("MONGODB_URI is not configured. Add your MongoDB Atlas URI to .env.");
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(getDbName());
  return db;
}

async function getCollection() {
  const database = await getDb();
  return database.collection(DEFAULT_COLLECTION_NAME);
}

function normalizeConversationId(conversationId) {
  return String(conversationId || "default").trim().slice(0, 120) || "default";
}

function sanitizeAttachment(attachment = {}) {
  return {
    name: String(attachment.name || "").slice(0, 240),
    mimeType: String(attachment.mimeType || "application/octet-stream").slice(0, 120),
    size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
    contextOnly: Boolean(attachment.contextOnly),
  };
}

function sanitizeMessage(message = {}) {
  const time = message.time ? new Date(message.time) : new Date();
  const safeTime = Number.isNaN(time.getTime()) ? new Date() : time;

  return {
    id: String(message.id || `${Date.now()}:${Math.random().toString(16).slice(2)}`),
    text: String(message.text || "").slice(0, 20000),
    sender: message.sender === "user" ? "user" : "system",
    time: safeTime,
    rawResponse: message.rawResponse ? String(message.rawResponse).slice(0, 50000) : null,
    plan: Array.isArray(message.plan) ? message.plan.slice(0, 20) : [],
    attachments: Array.isArray(message.attachments)
      ? message.attachments.slice(0, 10).map(sanitizeAttachment)
      : [],
  };
}

async function saveChatMessage({ conversationId, message } = {}) {
  const collection = await getCollection();
  const sanitized = sanitizeMessage(message);
  const document = {
    ...sanitized,
    conversationId: normalizeConversationId(conversationId),
    updatedAt: new Date(),
  };

  await collection.updateOne(
    { conversationId: document.conversationId, id: document.id },
    { $set: document, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );

  return { ok: true, id: document.id };
}

async function listChatMessages({ conversationId, limit = MAX_HISTORY_MESSAGES } = {}) {
  const collection = await getCollection();
  const safeLimit = Math.max(1, Math.min(MAX_HISTORY_MESSAGES, Number(limit) || MAX_HISTORY_MESSAGES));
  const documents = await collection
    .find({ conversationId: normalizeConversationId(conversationId) })
    .sort({ time: 1, createdAt: 1 })
    .limit(safeLimit)
    .toArray();

  return documents.map(({ _id, createdAt, updatedAt, ...message }) => ({
    ...message,
    time: message.time?.toISOString?.() || message.time,
  }));
}

async function clearChatHistory({ conversationId } = {}) {
  const collection = await getCollection();
  await collection.deleteMany({ conversationId: normalizeConversationId(conversationId) });
  return { ok: true };
}

async function closeMongoConnection() {
  if (!client) return;
  await client.close();
  client = null;
  db = null;
}

module.exports = {
  saveChatMessage,
  listChatMessages,
  clearChatHistory,
  closeMongoConnection,
};
