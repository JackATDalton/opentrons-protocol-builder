/** Start from the working plate-to-tube example; never overwrite an existing tool. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function scaffoldProtocol(root: string, slug: string, dryRun = false): string[] {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Use a lowercase kebab-case name, e.g. colony-transfer.");
  }
  const name = slug.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  const read = (path: string) => readFileSync(resolve(root, path), "utf8");
  const files = new Map<string, string>();
  const app = read("src/ui/App.tsx");
  const fixtures = read("scripts/write-fixtures.ts");
  if (app.includes(`id: "${slug}"`) || fixtures.includes(`"${slug}.py"`)) {
    throw new Error(`Protocol ${slug} is already registered.`);
  }
  function replaceOnce(source: string, marker: string, replacement: string): string {
    if (source.split(marker).length !== 2) throw new Error(`Registration point changed: ${marker}. No files written.`);
    return source.replace(marker, replacement);
  }
  const generatorPath = `src/generators/${slug}.ts`;
  const viewPath = `src/ui/views/${name}View.tsx`;
  const testPath = `tests/${slug}.test.ts`;
  for (const path of [generatorPath, viewPath, testPath]) {
    if (existsSync(resolve(root, path))) throw new Error(`${path} already exists. No files written.`);
  }
  let generator = read("src/generators/transfer.ts").replace(/Transfer/g, name);
  // The legacy example has separate Python/step loops. Scaffold both from one
  // traversal instead, so an agent adapting it cannot change just one loop.
  generator = replaceOnce(generator, "  for (const p of plan) {", `  const commands: string[] = [];
  for (const p of plan) {`);
  const drop = '    rec.add({ kind: "drop_tip", label: `Drop tip — ${p.sourceWell} done`, sample: p.sourceWell });';
  generator = replaceOnce(generator, drop, `    rec.add({ kind: "blow_out", slot: rackSlots[p.rack - 1], labwareId: rackId, well: p.tube, label: "Blow out into destination tube" });
${drop}
    commands.push(
      "pipette.pick_up_tip()",
      "pipette.aspirate(TRANSFER_VOLUME_UL, plates[" + p.plate + "][" + py(p.sourceWell) + "].bottom(" + ASPIRATE_BOTTOM_MM + "))",
      "pipette.dispense(TRANSFER_VOLUME_UL, racks[" + p.rack + "][" + py(p.tube) + "].top(" + OPEN_LID_CLEARANCE_MM + "), rate=" + SLOW_DISPENSE_RATE + ")",
      "pipette.blow_out(racks[" + p.rack + "][" + py(p.tube) + "].top(" + OPEN_LID_CLEARANCE_MM + "))",
      "pipette.drop_tip()",
    );`);
  generator = replaceOnce(generator, 'ASPIRATE_BOTTOM_MM, P1000,', 'ASPIRATE_BOTTOM_MM, OPEN_LID_CLEARANCE_MM, SLOW_DISPENSE_RATE, P1000,');
  generator = replaceOnce(generator, 'note: "Dispensed above the tube, then blown out — the tip is discarded straight after.",', 'note: "Dispense 35 mm above the open tube, then blow out and discard the tip.",');
  const pythonStart = generator.indexOf("for entry in PLAN:");
  const pythonEnd = generator.indexOf('\nnotify(f"', pythonStart);
  if (pythonStart < 0 || pythonEnd < 0) throw new Error("Transfer template changed. No files written.");
  generator = generator.slice(0, pythonStart) + '${commands.join("\\n")}' + generator.slice(pythonEnd);
  files.set(generatorPath, `// Scaffold: plate-to-tube behaviour. Adapt and validate before lab use.\n` + generator);
  files.set(viewPath, read("src/ui/views/TransferView.tsx")
    .replace(/Transfer/g, name).replace('"../../generators/transfer"', `"../../generators/${slug}"`)
    .replace("<Messages errors=", '<p className="note">Development scaffold: plate-to-tube behaviour; adapt before lab use.</p>\n      <Messages errors='));
  files.set(testPath, `import { describe, expect, it } from "vitest";
import { STEEL_LAB_FLEX } from "../src/core/deck";
import { checkTipHygiene } from "../src/core/invariants";
import { generate${name} } from "../src/generators/${slug}";

// Replace these starter expectations with the intended protocol's behaviour.
describe("${slug}", () => {
  it("keeps the loading map and fresh-tip transfers explicit", () => {
    const result = generate${name}({
      deck: STEEL_LAB_FLEX,
      plates: [{ plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt", selectedWells: ["B1", "A1"] }],
      transferVolumeUl: 100,
    });
    expect(result.plan.map((p) => [p.sourceWell, p.tube])).toEqual([["A1", "A1"], ["B1", "A2"]]);
    expect(result.tipsUsed).toBe(2);
    expect(checkTipHygiene(result.steps)).toEqual([]);
  });
  it("rejects an empty setup", () => {
    expect(() => generate${name}({ deck: STEEL_LAB_FLEX, plates: [], transferVolumeUl: 100 })).toThrow(/source plate/i);
  });
});
`);
  let registered = replaceOnce(app, 'type ToolId = ', `import { ${name}View } from "./views/${name}View";\n\ntype ToolId = "${slug}" | `);
  registered = replaceOnce(registered, 'const TOOLS: Tool[] = [', `const TOOLS: Tool[] = [
  {
    id: "${slug}", name: "${name} (development)", what: "plate-to-tube starter",
    ready: true,
    description: "Development scaffold using plate-to-tube behaviour. Adapt and validate before lab use.",
    options: [{ name: "Starter setup", what: "Select source wells and a transfer volume. Replace with the intended protocol's inputs." }],
  },`);
  registered = replaceOnce(registered, '          {toolId === "transfer"', `          {toolId === "${slug}" && <${name}View {...shared} />}\n          {toolId === "transfer"`);
  files.set("src/ui/App.tsx", registered);
  let registeredFixtures = replaceOnce(fixtures, 'const here = ', `import { generate${name} } from "../src/generators/${slug}";\n\nconst here = `);
  registeredFixtures += `\n// ${slug}: replace with an awkward representative case as the protocol evolves.\nwrite("${slug}.py", generate${name}({
  deck: STEEL_LAB_FLEX,
  plates: [{ plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt", selectedWells: ["A1", "B1", "A2"] }],
  transferVolumeUl: 100, notify, author: "fixture",
}).source);\n`;
  files.set("scripts/write-fixtures.ts", registeredFixtures);
  if (!dryRun) {
    for (const [path, content] of files) {
      mkdirSync(dirname(resolve(root, path)), { recursive: true });
      writeFileSync(resolve(root, path), content);
    }
  }
  return [...files.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npm run protocol:new -- <kebab-case-name> [--dry-run]\nCreates a plate-to-tube starter generator, view, tests and registrations. Adapt before lab use.");
  } else {
    try {
      const names = args.filter((arg) => !arg.startsWith("--"));
      if (names.length !== 1 || args.some((arg) => arg.startsWith("--") && arg !== "--dry-run")) throw new Error("Usage: npm run protocol:new -- <kebab-case-name> [--dry-run]");
      const dryRun = args.includes("--dry-run");
      console.log(scaffoldProtocol(process.cwd(), names[0], dryRun).map((path) => `${dryRun ? "Would write" : "Wrote"} ${path}`).join("\n"));
      console.log("Next: adapt the starter, then follow docs/adding-a-protocol.md and run npm run check, fixtures and simulate.");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
