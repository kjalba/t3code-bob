const DEFAULT_MAX_OUTPUT_SIZE = 1024 * 1024;
const TRUNCATION_SUFFIX = '...[truncated]';

interface LimitResult<T> {
  payload: T;
  truncated: boolean;
}

function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }

  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }

  const suffixBytes = Buffer.byteLength(TRUNCATION_SUFFIX, 'utf8');
  const budget = Math.max(0, maxBytes - suffixBytes);
  let result = '';

  for (const char of text) {
    const next = result + char;
    if (Buffer.byteLength(next, 'utf8') > budget) {
      break;
    }
    result = next;
  }

  return `${result}${TRUNCATION_SUFFIX}`;
}

function limitValue(value: unknown, maxBytes: number): { value: unknown; truncated: boolean } {
  if (typeof value === 'string') {
    const limited = truncateToUtf8Bytes(value, maxBytes);
    return {
      value: limited,
      truncated: limited !== value,
    };
  }

  if (Array.isArray(value)) {
    let truncated = false;
    const limitedArray = value.map((item) => {
      const result = limitValue(item, maxBytes);
      truncated = truncated || result.truncated;
      return result.value;
    });
    return { value: limitedArray, truncated };
  }

  if (value && typeof value === 'object') {
    let truncated = false;
    const limitedObject: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      const result = limitValue(nestedValue, maxBytes);
      truncated = truncated || result.truncated;
      limitedObject[key] = result.value;
    }
    return { value: limitedObject, truncated };
  }

  return { value, truncated: false };
}

export function getMaxOutputSize(): number {
  const configured = Number.parseInt(process.env.BOB_MAX_OUTPUT_SIZE || '', 10);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MAX_OUTPUT_SIZE;
  }
  return configured;
}

export function limitOutputSize<T>(payload: T, maxBytes: number = getMaxOutputSize()): LimitResult<T> {
  const result = limitValue(payload, maxBytes);
  return {
    payload: result.value as T,
    truncated: result.truncated,
  };
}

