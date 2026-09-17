const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DeviceIdentity,
  createDeviceCode,
  parseHardwareId,
  parseMachineGuid,
  parseSmbiosUuid,
} = require("../src/main/services/device-identity.cjs");

const MACHINE_GUID_OUTPUT = "    MachineGuid    REG_SZ    01234567-89AB-CDEF-0123-456789ABCDEF\r\n";
const HARDWARE_ID_OUTPUT = "    ComputerHardwareId    REG_SZ    {AABBCCDD-1122-3344-5566-77889900AABB}\r\n";

test("normalizes Windows identifiers into a stable opaque device code", () => {
  const machineGuid = parseMachineGuid(MACHINE_GUID_OUTPUT);
  const hardwareId = parseHardwareId(HARDWARE_ID_OUTPUT);
  const first = createDeviceCode({ machineGuid, hardwareId });
  const second = createDeviceCode({ machineGuid: machineGuid.toUpperCase(), hardwareId: `{${hardwareId}}` });
  assert.match(first, /^CPD1-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
  assert.equal(first, second);
  assert.doesNotMatch(first, /01234567|AABBCCDD/);
});

test("rejects placeholder SMBIOS identifiers", () => {
  assert.equal(parseSmbiosUuid("00000000-0000-0000-0000-000000000000"), "");
  assert.equal(parseSmbiosUuid("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"), "");
});

test("requires both Windows identifiers so a transient command failure cannot change the device code", async () => {
  const identity = new DeviceIdentity({
    platform: "win32",
    systemRoot: "C:\\Windows",
    runCommand: async (_file, args) => args.includes("MachineGuid") ? MACHINE_GUID_OUTPUT : "",
  });
  await assert.rejects(() => identity.getCode(), { code: "DEVICE_ID_UNAVAILABLE" });
});

test("caches the device code after successful collection", async () => {
  let calls = 0;
  const identity = new DeviceIdentity({
    platform: "win32",
    runCommand: async (_file, args) => {
      calls += 1;
      return args.includes("MachineGuid") ? MACHINE_GUID_OUTPUT : HARDWARE_ID_OUTPUT;
    },
  });
  assert.equal(await identity.getCode(), await identity.getCode());
  assert.equal(calls, 2);
});
