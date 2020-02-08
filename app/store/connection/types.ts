export enum Types {
    CONNECTING = "@connections/connecting",
    CONNECTED = "@connections/connected",
    CREATING = "@connections/creating",
    ADDING = "@connections/adding",
    ADD = "@connections/add",
    DELETE = "@connections/delete",
    UPDATE = "@connections/update",
    LOAD = "@connections/load",
    LOADING = "@connections/loading",
    ACTIVE = "@connections/active",
}

export interface IConnectionConfig {
    id: string;
    name: string;
    host: string;
    user: string;
    password: string;
    type: string;
}
export interface ICreating {
    type: Types.CREATING;
    payload: boolean;
}

export interface IAdding {
    type: Types.ADDING;
    payload: boolean;
}

