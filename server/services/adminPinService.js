// server/services/adminPinService.js
// DB-only admin PIN service.
// Stores Admin PIN in PocketBase collection: admin_settings
// Record key: admin_pin

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const COLLECTION = "admin_settings";
const PIN_KEY = "admin_pin";
const DEFAULT_PIN = "1234";

function clean(value) {
  return String(value ?? "").trim();
}

function isMissingCollectionError(err) {
  return err?.status === 404 || /missing collection context/i.test(String(err?.message || ""));
}

function textField(name, required = false) {
  return {
    name,
    type: "text",
    system: false,
    required,
    presentable: false,
    unique: name === "setting_key",
    options: {
      min: null,
      max: null,
      pattern: ""
    }
  };
}

async function ensureCollection() {
  let collection = null;

  try {
    collection = await pocketBaseRequest(`/api/collections/${COLLECTION}`, { method: "GET" });
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err;
  }

  if (!collection) {
    const payloads = [
      {
        name: COLLECTION,
        type: "base",
        system: false,
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [textField("setting_key", true), textField("setting_value", false)]
      },
      {
        name: COLLECTION,
        type: "base",
        system: false,
        listRule: "",
        viewRule: "",
        createRule: "",
        updateRule: "",
        deleteRule: "",
        schema: [textField("setting_key", true), textField("setting_value", false)]
      }
    ];

    let lastErr = null;
    for (const payload of payloads) {
      try {
        return await pocketBaseRequest("/api/collections", { method: "POST", body: payload });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  return collection;
}

async function listSettings() {
  await ensureCollection();
  const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
    method: "GET",
    query: {
      page: 1,
      perPage: 50,
      filter: `setting_key="${PIN_KEY}"`
    }
  });

  return Array.isArray(result.items) ? result.items : [];
}

async function getPinRecord() {
  const items = await listSettings();
  return items[0] || null;
}

async function getAdminPin() {
  const record = await getPinRecord();

  if (record?.setting_value) {
    return clean(record.setting_value);
  }

  const created = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
    method: "POST",
    body: {
      setting_key: PIN_KEY,
      setting_value: DEFAULT_PIN
    }
  });

  return clean(created.setting_value || DEFAULT_PIN);
}

async function verifyAdminPin(pin) {
  const savedPin = await getAdminPin();
  return clean(pin) === clean(savedPin);
}

async function updateAdminPin(newPin) {
  const pin = clean(newPin);

  if (!pin) {
    const err = new Error("New PIN cannot be blank.");
    err.status = 400;
    throw err;
  }

  if (pin.length < 4) {
    const err = new Error("New PIN must be at least 4 characters.");
    err.status = 400;
    throw err;
  }

  const existing = await getPinRecord();

  if (existing?.id) {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records/${existing.id}`, {
      method: "PATCH",
      body: {
        setting_value: pin
      }
    });
  } else {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "POST",
      body: {
        setting_key: PIN_KEY,
        setting_value: pin
      }
    });
  }

  return { ok: true, message: "Admin PIN updated in DB." };
}

module.exports = {
  getAdminPin,
  verifyAdminPin,
  updateAdminPin
};
