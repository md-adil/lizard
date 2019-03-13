import * as conf from "conf";
import * as os from "os";
import * as fs from "./fs";

class Config {
    private configsDir = `${os.homedir()}/lizard`;
    private paths: any = {
        connections: this.configsDir + "/connections.json",
        configs: this.configsDir + "/configs.json"
    }

    constructor() {
        if(!fs.isExists(this.configsDir)) {
            fs.isExists(this.configsDir);
        }
    }

    public async set(key: string, value: any): Promise<void> {
        if(key in this.paths) {
            await fs.write(this.paths[key], JSON.stringify(value));
        } else {
            await fs.write(this.paths.configs, JSON.stringify(value));
        }
    }

    public async get(key: string): Promise<any> {
        const _path = this.paths[key] || this.paths.configs;
        const data = await fs.read(_path);
        if(!data) return data;
        return JSON.parse(data.toString());
    }
}

export default new Config();
