const assert = require("node:assert/strict");
const test = require("node:test");
const { REGISTRY_KEY, WindowsLicenseStore, parseRegistryLicense } = require("../src/main/services/windows-license-store.cjs");

const CODE = `CPL1.${"A".repeat(120)}.${"B".repeat(86)}`;

test("reads and writes the update-safe Windows license value", () => {
  const calls = [];
  const store = new WindowsLicenseStore({
    platform: "win32",
    systemRoot: "C:\\Windows",
    runCommand: (_file, args) => {
      calls.push(args);
      return args[0] === "QUERY" ? `    LicenseCode    REG_SZ    ${CODE}\r\n` : "";
    },
  });

  assert.equal(store.read(), CODE);
  assert.equal(store.write(CODE), true);
  store.clear();
  assert.deepEqual(calls[0], ["QUERY", REGISTRY_KEY, "/v", "LicenseCode"]);
  assert.equal(calls[1].includes(CODE), true);
  assert.equal(calls[2][0], "DELETE");
});

test("ignores unrelated or malformed registry output", () => {
  assert.equal(parseRegistryLicense("LicenseCode REG_BINARY 1234"), "");
  assert.equal(parseRegistryLicense("OtherValue REG_SZ CPL1.a.b"), "");
});
