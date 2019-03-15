import * as fs from "fs";

export const write = (p: string, content: any) => new Promise<void>((r, e) => {
    fs.writeFile(p, content, (err) => {
        if (err) {
            e(err);
        } else {
            r();
        }
    });
});

export const read = (p: string) => new Promise<Buffer>((r, e) => {
    fs.readFile(p, (err, data) => {
        if (err) {
            e(err);
        } else {
            r(data);
        }
    });
});

export const isExists = (p: string) => new Promise<boolean>((r, _) => {
    fs.access(p, fs.constants.F_OK, (err) => {
        r(err ? false : true);
    });
});

export const isDirectory = (p: string) => new Promise<boolean>((r, e) => {
    fs.lstat(p, (err, stats) => {
        if (err) {
            e(err);
        } else {
            r(stats.isDirectory());
        }
    });
});

export const unlink = (p: string) => new Promise<void>((r, e) => {
    fs.unlink(p, (err: Error | undefined) => {
        if (err) {
            e(err);
        } else {
            r();
        }
    });
});

export const mkdir = (p: string, options: any = {}) => new Promise<void>((r, e) => {
    fs.mkdir(p, options, (err) => {
        if (err) {
            e(err);
        } else {
            r();
        }
    });
});
