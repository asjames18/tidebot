/**
 * Helpers for running `.cmd` shims (npm.cmd / npx.cmd) from child processes.
 *
 * Node refuses to spawn `.bat`/`.cmd` files directly on Windows without a
 * shell (EINVAL, from the CVE-2024-27980 hardening), so those calls must go
 * through cmd.exe with a quoted command line instead of an argv array.
 */

/** Quote one argument for cmd.exe, escaping embedded quotes and trailing slashes. */
export function quoteForCmd(arg) {
  const value = String(arg);
  if (value === '') return '""';
  if (!/[\s"&|<>^()%!,;]/.test(value)) return value;
  const escaped = value
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/, '$1$1');
  return `"${escaped}"`;
}

/** Build a single cmd.exe command line for `cmd` plus `args`. */
export function buildWindowsCommand(cmd, args) {
  return [cmd, ...args.map(quoteForCmd)].join(' ');
}
