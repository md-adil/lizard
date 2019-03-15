import * as config from "../libs/config";

export const CREATE = "CONECTIONS CREATE";
export const ADD = "CONNECTIONS ADD";
export const DELETE = "CONNECTIONS DELETE";
export const UPDATE = "CONNECTIONS UPDATE";
export const LOAD = "CONNECTION LOAD";
export const LOADING = "CONNECTION LOADING";

export interface IConnection {
    name: string;
    host: string;
    user: string;
    password: string;
    type: string;
}

export interface IConnectionState {
    isCreating: boolean;
    isLoading: boolean;
    data: IConnection[];
}

export interface IConnectionAction {
    type: string;
    payload: boolean | IConnection;
}

export interface IConnectionActionLoad {
    type: typeof LOAD;
    payload: IConnection[];
}

export type ConnectionActionTypes = IConnectionAction | IConnectionActionLoad;

export const isCreating = (creating: boolean): IConnectionAction => {
    return { type: CREATE, payload: creating };
};

export const isLoading = (loading: boolean) => {
    return { type: LOADING, payload: loading };
};

export const add = (connection: IConnection) => async (dispatch: any, getState: any) => {
    const connections = getState().connection.data.concat([connection]);
    dispatch(isLoading(true));
    await config.set("connections", connections);
    dispatch({ type: ADD, payload: connection });
    dispatch(isCreating(false));
    dispatch(isLoading(false));
};

export const destroy = (connection: IConnection): IConnectionAction => {
    return {type: DELETE, payload: connection};
};

export const update = (connection: IConnection): IConnectionAction => {
    return {type: DELETE, payload: connection};
};

export const fetch = () => async (dispatch: any) => {
    dispatch({type: LOADING, payload: true});
    const connections = await config.get("connections");
    if (connections) {
        dispatch({ type: LOAD, payload: connections });
    }
    dispatch({type: LOADING, payload: false});
};
