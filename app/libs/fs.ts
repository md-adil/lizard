import * as fs from "fs";

export const write = (_path: string, content: any) => new Promise<void>((r, e) => {
    fs.writeFile(_path, content, (err) => {
        if(err) {
            e(err);
        } else {
            r();
        }
    })
});

export const read = (_path: string) => new Promise<Buffer>((r, e) => {
    fs.readFile(_path, (err, data) => {
        if(err) {
            e(err);
        } else {
            r(data);
        }
    });
});

export const isExists = (_path: string) => new Promise<boolean>((r, _) => {
    fs.access(_path, fs.constants.F_OK, (err) => {
        r(err ? false : true);
    })
});

export const isDirectory = (_path: string) => new Promise<boolean>((r, e) => {
    fs.lstat(_path, (err, stats) => {
        if(err) {
            e(err);
        } else {
            r(stats.isDirectory());
        }
    });
});


export const unlink = (_path: string) => new Promise<void>((r, e) => {
    fs.unlink(_path, (err: Error | undefined) => {
        if(err) {
            e(err);
        } else {
            r();
        }
    });
});

export const mkdir = (_path: string, options: any = {}) => new Promise<void>((r, e) => {
    fs.mkdir(_path, options, (err) => {
        if(err) {
            e(err);
        } else {
            r();
        }
    })
})
