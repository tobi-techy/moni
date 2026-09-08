// BigInt-safe JSON (transaction amounts are bigints)
export function bigintJSONReplacer(_key: string, value: any): any {
  if (typeof value === 'bigint') {
    return { $bigint: value.toString() };
  }
  return value;
}

export function bigintJSONReviver(_key: string, value: any): any {
  if (value && typeof value === 'object' && typeof value.$bigint === 'string') {
    return BigInt(value.$bigint);
  }
  return value;
}

export function safeJSONStringify(value: any): string {
  return JSON.stringify(value, bigintJSONReplacer);
}