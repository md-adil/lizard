import * as conf from "conf";

class Config {
    public set(key: string, value: any) {
        conf.set(key, value);
    }

    public get(key: string): any {
        return conf.get(key);
    }
}

export default new Config();
