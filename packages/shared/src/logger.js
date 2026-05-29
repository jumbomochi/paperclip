import pino from 'pino';
import { existsSync, mkdirSync } from 'node:fs';
export function makeLogger(name) {
    const dir = process.env.LOG_FILE_DIR;
    if (dir) {
        try {
            mkdirSync(dir, { recursive: true });
            return pino({ name, level: process.env.LOG_LEVEL ?? 'info' }, pino.destination({ dest: `${dir}/${name}.log`, sync: false }));
        }
        catch {
            // fall through to stdout
        }
    }
    return pino({
        name,
        level: process.env.LOG_LEVEL ?? 'info',
        transport: process.env.LOG_PRETTY === '1' ? { target: 'pino-pretty' } : undefined,
    });
}
