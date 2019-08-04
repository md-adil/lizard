import * as config from "../../libs/config";
import { Dispatch } from "redux";
import Connection from "../../db/Connection";

export const CONNECTING = "@connections/connecting";
export const CONNECTED = "@connections/connected";
export const CREATING = "@connections/creating";
export const ADDING = "@connections/adding";
export const ADD = "@connections/add";
export const DELETE = "@connections/delete";
export const UPDATE = "@connections/update";
export const LOAD = "@connections/load";
export const LOADING = "@connections/loading";
export const ACTIVE = "@connections/active";

export interface IConnectionConfig {
    id: string;
    name: string;
    host: string;
    user: string;
    password: string;
    type: string;
}

interface ICreating {
    type: typeof CREATING;
    payload: boolean;
}

export const creating = (isCreate: boolean): ICreating => ({
    type: CREATING,
    payload: isCreate
});

interface IAdding {
    type: typeof ADDING;
    payload: boolean;
}

export const adding = (payload: boolean): IAdding => {
    return { type: ADDING, payload };
};

interface ILoading {
    type: typeof LOADING;
    payload: boolean;
}

export const isLoading = (loading: boolean): ILoading => {
    return { type: LOADING, payload: loading };
};

interface IAdd {
    type: typeof ADD;
    payload: Connection;
}

export const add = (connection: Connection) => async (
    dispatch: any,
    getState: any
) => {
    const connections = getState().connection.data.concat([connection]);
    dispatch(adding(true));
    await config.set("connections", connections);
    dispatch({ type: ADD, payload: connection });
};

interface IDestroy {
    type: typeof DELETE;
    payload: Connection;
}

export const destroy = (connection: Connection): IDestroy => {
    return { type: DELETE, payload: connection };
};

interface IUpdate {
    type: typeof UPDATE;
    payload: Connection;
    data: IConnectionConfig;
}

export const update = (
    connection: Connection,
    data: IConnectionConfig
): IUpdate => {
    return { type: UPDATE, payload: connection, data };
};

interface ILoaded {
    type: typeof LOAD;
    payload: Connection[];
}

interface ILoading {
    type: typeof LOADING;
    payload: boolean;
}

export const fetch = () => async (dispatch: any) => {
    dispatch({ type: LOADING, payload: true });
    const connections = await config.get("connections");
    if (connections) {
        dispatch({
            type: LOAD,
            payload: connections.map(
                (conf: IConnectionConfig) => new Connection(conf)
            )
        });
    }
    dispatch({ type: LOADING, payload: false });
};

interface IConnected {
    type: typeof CONNECTED;
    payload: Connection;
}

interface IConnecting {
    type: typeof CONNECTING;
    payload: Connection;
}

export const connect = (connection: Connection) => async (
    dispatch: Dispatch
) => {
    dispatch({ type: CONNECTING, payload: connection });
    try {
        await connection.connect();
    } catch (err) {
        alert(err.message);
    }
    dispatch({ type: CONNECTED, payload: connection });
};

interface IActive {
    type: typeof ACTIVE;
    payload: string;
}

export const active = (payload: string) => ({ type: ACTIVE, payload });

export type ConnectionActionTypes =
    | ICreating
    | ILoading
    | ILoaded
    | IConnecting
    | IConnected
    | IAdding
    | IAdd
    | ILoading
    | IUpdate
    | IDestroy
    | IActive;
