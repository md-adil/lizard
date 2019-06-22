import * as conf from "conf";
import * as os from "os";
import * as fs from "./fs";

const configsDir = `${os.homedir()}/.lizard`;
const paths: any = {
    configs: configsDir + "/configs.json",
    connections: configsDir + "/connections.json",
};

fs.isExists(configsDir).then((exist: boolean) => {
    if (!exist) {
        return fs.mkdir(configsDir);
    }
});

export const set = async (key: string, value: any): Promise<void> => {
    if (key in paths) {
        await fs.write(paths[key], JSON.stringify(value));
    } else {
        await fs.write(paths.configs, JSON.stringify(value));
    }
};

export const get = async (key: string): Promise<any> => {
    const p = paths[key] || paths.configs;
    const data = await fs.read(p);
    if (!data) {
        return data;
    }
    return JSON.parse(data.toString());
};
