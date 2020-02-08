import * as config from "../../libs/config";
import { Dispatch } from "redux";
import Connection from "../../db/Connection";
import { Types, IAdding, ICreating, IConnectionConfig } from "./types";

export const creating = (isCreate: boolean): ICreating => ({
    type: Types.CREATING,
    payload: isCreate
});

export const adding = (payload: boolean): IAdding => {
    return { type: Types.ADDING, payload };
};

interface ILoading {
    type: Types.LOADING;
    payload: boolean;
}

export const isLoading = (loading: boolean): ILoading => {
    return { type: Types.LOADING, payload: loading };
};

interface IAdd {
    type: Types.ADD;
    payload: Connection;
}

export const add = (connection: Connection) => async (
    dispatch: any,
    getState: any
) => {
    const connections = getState().connection.data.concat([connection]);
    dispatch(adding(true));
    await config.set("connections", connections);
    dispatch({ type: Types.ADD, payload: connection });
};

interface IDestroy {
    type: Types.DELETE;
    payload: Connection;
}

export const destroy = (connection: Connection): IDestroy => {
    return { type: Types.DELETE, payload: connection };
};

interface IUpdate {
    type: Types.UPDATE;
    payload: Connection;
    data: IConnectionConfig;
}

export const update = (
    connection: Connection,
    data: IConnectionConfig
): IUpdate => {
    return { type: Types.UPDATE, payload: connection, data };
};

interface ILoaded {
    type: Types.LOAD;
    payload: Connection[];
}

interface ILoading {
    type: Types.LOADING;
    payload: boolean;
}

export const fetch = () => async (dispatch: any) => {
    dispatch({ type: Types.LOADING, payload: true });
    const connections = await config.get("connections");
    if (connections) {
        dispatch({
            type: Types.LOAD,
            payload: connections.map(
                (conf: IConnectionConfig) => new Connection(conf)
            )
        });
    }
    dispatch({ type: Types.LOADING, payload: false });
};

interface IConnected {
    type: Types.CONNECTED;
    payload: Connection;
}

interface IConnecting {
    type: Types.CONNECTING;
    payload: Connection;
}

export const connect = (connection: Connection) => async (
    dispatch: Dispatch
) => {
    dispatch({ type: Types.CONNECTING, payload: connection });
    try {
        await connection.connect();
    } catch (err) {
        alert(err.message);
    }
    dispatch({ type: Types.CONNECTED, payload: connection });
};

interface IActive {
    type: Types.ACTIVE;
    payload: string;
}

export const active = (payload: string) => ({ type: Types.ACTIVE, payload });

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
