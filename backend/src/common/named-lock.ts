import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Runs `fn` while holding a MariaDB named lock, so the same action on the
// same record can't run twice at once (a double click, two users pressing
// "Convert" together). The second caller gets a clear message instead of a
// duplicate document. The lock lives on one dedicated connection and is
// always released.
export async function withNamedLock<T>(dataSource: DataSource, name: string, busyMessage: string, fn: () => Promise<T>): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  const key = name.slice(0, 64);
  try {
    const [row] = await runner.query('SELECT GET_LOCK(?, 0) AS got', [key]);
    if (Number(row?.got) !== 1) throw new ConflictException(busyMessage);
    try {
      return await fn();
    } finally {
      await runner.query('SELECT RELEASE_LOCK(?)', [key]).catch(() => undefined);
    }
  } finally {
    await runner.release();
  }
}
