const electron = require("electron");

if (
  !electron ||
  typeof electron !== "object" ||
  !electron.app ||
  !electron.BrowserWindow ||
  !electron.Menu ||
  !electron.ipcMain
) {
  console.error("ELECTRON_RUN_AS_NODE esta activo, desactivalo.");
  console.error("Usa 'npm run start:linux' o limpia la variable antes de ejecutar.");
  process.exit(1);
}

const { initMainProcess } = require("./main/bootstrap");

if (process.env.KV_VERIFY_MAIN === "1") {
  const { verifyMainWiring } = require("./main/diagnostics/wiring-verify");
  const wiringReport = verifyMainWiring();

  console.log("[KV][verify-main] wiring verification mode enabled");
  console.log("[KV][verify-main] checks:");
  wiringReport.checks.forEach((check) => {
    const suffix = check.detail ? ` - ${check.detail}` : "";
    console.log(`  [${check.ok ? "OK" : "FAIL"}] ${check.name}${suffix}`);
  });
  console.log(
    `[KV][verify-main] summary: passed=${wiringReport.summary.passed} failed=${wiringReport.summary.failed}`
  );

  if (!wiringReport.ok) {
    const failedChecks = wiringReport.checks.filter((check) => !check.ok);
    failedChecks.forEach((check) => {
      const suffix = check.detail ? ` - ${check.detail}` : "";
      console.error(`[KV][verify-main] failed check: ${check.name}${suffix}`);
    });
    process.exit(1);
  }
}

initMainProcess();
