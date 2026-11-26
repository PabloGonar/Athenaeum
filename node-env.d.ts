declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readFileSync(path: string, encoding: "utf-8"): string;
  export function readFileSync(path: string): Uint8Array;
  export function writeFileSync(path: string, data: string, encoding?: "utf-8"): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { mtime: Date; isDirectory(): boolean };
  export function unlinkSync(path: string): void;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
  export function basename(path: string, ext?: string): string;
}

declare function fetch(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;
