export type LogFields = Record<string, string | number | boolean | null>;

export type Logger = {
  info(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
};

function write(level: 'info' | 'error', msg: string, fields?: LogFields): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

/** 토큰과 API 키는 호출하는 쪽에서 필드에 넣지 않는다. */
export const log: Logger = {
  info(msg, fields) {
    write('info', msg, fields);
  },
  error(msg, fields) {
    write('error', msg, fields);
  },
};
