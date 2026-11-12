import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scaffoldProtocol } from "../scripts/new-protocol";

const roots: string[] = [];
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "protocol-scaffold-"));
  roots.push(root);
  for (const path of ["src/generators/transfer.ts", "src/ui/views/TransferView.tsx", "src/ui/App.tsx", "scripts/write-fixtures.ts"]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), readFileSync(path));
  }
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("protocol scaffold", () => {
  it("previews without writing, then connects a new generator, view, test and fixture", () => {
    const root = workspace();
    const paths = scaffoldProtocol(root, "colony-transfer", true);
    expect(paths).toHaveLength(5);
    expect(existsSync(join(root, paths[0]))).toBe(false);
    scaffoldProtocol(root, "colony-transfer");
    const read = (path: string) => readFileSync(join(root, path), "utf8");
    expect(read(paths[0])).toContain("export function generateColonyTransfer");
    expect(read(paths[1])).toContain('../../generators/colony-transfer');
    expect(read("src/ui/App.tsx")).toContain('toolId === "colony-transfer" && <ColonyTransferView');
    expect(read("scripts/write-fixtures.ts")).toContain('write("colony-transfer.py", generateColonyTransfer(');
    const previous = read("src/ui/App.tsx");
    expect(() => scaffoldProtocol(root, "colony-transfer")).toThrow(/already/);
    expect(read("src/ui/App.tsx")).toBe(previous);
  });
  it("refuses unsafe names, existing files and changed registration points without partial writes", () => {
    const root = workspace();
    expect(() => scaffoldProtocol(root, "../escape")).toThrow(/kebab-case/);
    writeFileSync(join(root, "src/generators/existing.ts"), "keep me");
    expect(() => scaffoldProtocol(root, "existing")).toThrow(/already exists/);
    const appPath = join(root, "src/ui/App.tsx");
    writeFileSync(appPath, readFileSync(appPath, "utf8").replace("type ToolId = ", "type RenamedToolId = "));
    expect(() => scaffoldProtocol(root, "new-tool")).toThrow(/Registration point changed/);
    expect(existsSync(join(root, "src/generators/new-tool.ts"))).toBe(false);
  });
});
