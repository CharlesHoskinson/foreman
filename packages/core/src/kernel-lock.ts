/** Anchored Linux kernel ownership for run leases and journal transactions. */
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, writeFileSync, type Stats } from 'node:fs';
import { spawnSync } from 'node:child_process';
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
const protectedEntry = (info: Stats, mode: number) => info.uid === process.geteuid!() && (info.mode & 0o7777) === mode;
function installedFlock(): string | null {
    for (const path of ['/usr/bin/flock', '/bin/flock']) {
        try {
            const real = realpathSync(path), info = lstatSync(real);
            if (info.isFile() && info.uid === 0 && (info.mode & 0o022) === 0 && (info.mode & 0o111) !== 0) return real;
        } catch { /* The required installed utility may be absent. */ }
    }
    return null;
}
/** The caller retains its anchored run descriptor until this handle is closed.
 * The directory and lock inode remain in place after release. Older mkdir-only
 * clients see the persistent directory and cannot acquire a competing lease. */
export function acquireKernelDirectoryLock(runFd: number, entryName: string, protocol: string): { readonly release: () => void } | null {
    if (process.platform !== 'linux' || !process.geteuid || !/^[-a-zA-Z0-9_.]{1,160}$/.test(entryName) || entryName === '.' || entryName === '..' || !protocol || protocol.length > 120) return null;
    const executable = installedFlock();
    if (!executable) return null;
    let directoryFd: number | undefined, lockFd: number | undefined;
    try {
        const run = fstatSync(runFd);
        if (!run.isDirectory() || run.uid !== process.geteuid() || (run.mode & 0o022) !== 0) return null;
        const directoryPath = `/proc/self/fd/${runFd}/${entryName}`;
        let created = false;
        try { mkdirSync(directoryPath, { mode: 0o700 }); created = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return null; }
        directoryFd = openSync(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        const directory = fstatSync(directoryFd);
        if (!directory.isDirectory() || !protectedEntry(directory, 0o700) || !same(directory, lstatSync(directoryPath))) return null;
        const lockPath = `/proc/self/fd/${directoryFd}/owner-v1.lock`;
        lockFd = openSync(lockPath, constants.O_RDWR | constants.O_NOFOLLOW | (created ? constants.O_CREAT | constants.O_EXCL : 0), 0o600);
        const lock = fstatSync(lockFd);
        if (!lock.isFile() || lock.nlink !== 1 || !protectedEntry(lock, 0o600) || !same(lock, lstatSync(lockPath))) return null;
        const marker = Buffer.from(JSON.stringify({ protocol, runDevice: run.dev, runInode: run.ino, directoryDevice: directory.dev, directoryInode: directory.ino, lockDevice: lock.dev, lockInode: lock.ino }) + '\n');
        if (created) {
            writeFileSync(lockFd, marker); fsyncSync(lockFd); fsyncSync(directoryFd); fsyncSync(runFd);
        } else {
            if (lock.size !== marker.length) return null;
            const bytes = Buffer.alloc(marker.length);
            if (readSync(lockFd, bytes, 0, bytes.length, 0) !== bytes.length || !bytes.equals(marker)) return null;
        }
        // flock(1) locks inherited descriptor 3. It refers to the same open file
        // description as lockFd, so helper exit preserves this process's lock.
        const acquired = spawnSync(executable, ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', lockFd], timeout: 5000, env: { PATH: '/usr/bin:/bin', LANG: 'C' } });
        if (acquired.status !== 0 || acquired.error || !same(run, fstatSync(runFd)) || !same(directory, lstatSync(directoryPath)) || !same(lock, lstatSync(lockPath)) || !protectedEntry(fstatSync(lockFd), 0o600)) return null;
        const heldDirectory = directoryFd, heldLock = lockFd;
        directoryFd = undefined; lockFd = undefined;
        let held = true;
        return { release: () => { if (!held) return; held = false; try { closeSync(heldLock); } finally { closeSync(heldDirectory); } } };
    } catch { return null; }
    finally {
        if (lockFd !== undefined) closeSync(lockFd);
        if (directoryFd !== undefined) closeSync(directoryFd);
    }
}
