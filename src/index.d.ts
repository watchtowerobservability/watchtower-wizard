export interface Detected { kind: string; framework: string; pm?: string; ts?: boolean; file?: string }
export interface Edit { op: "write" | "append" | "patch"; path: string | string[]; content?: string; find?: RegExp; insert?: (m: string) => string }
export interface Plan { install: string[][]; edits: Edit[]; notes: string[]; keyKind: "secret" | "publishable" | "none"; keyVar: string }
export interface Change { path: string; before?: string | null; after?: string; skipped?: string; secret?: boolean }

export function detect(dir: string): Detected | null;
export function plan(d: Detected): Plan;
export function changes(dir: string, p: Plan, env: Record<string, string>): Change[];
export function render(c: Change, secretNames?: string[]): string;
export function write(dir: string, cs: Change[]): void;
export function install(dir: string, cmds: string[][], run?: (cmd: string, args: string[]) => { status: number | null }): { ok: boolean; cmd?: string };
export function sendTestEvent(o: { endpoint?: string; key: string; service?: string; fetchImpl?: typeof fetch }): Promise<{ ok: boolean; status: number; error?: string }>;
export function main(argv: string[], o?: Record<string, unknown>): Promise<number>;
