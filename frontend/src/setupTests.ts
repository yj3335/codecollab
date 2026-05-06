import "@testing-library/jest-dom";

if (!global.crypto) {
  // jsdom in CRA tests may not provide Web Crypto.
  (global as any).crypto = {};
}

if (!global.crypto.randomUUID) {
  global.crypto.randomUUID = () => "test-uuid";
}
