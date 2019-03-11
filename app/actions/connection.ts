export const CREATE = "CONECTIONS CREATE";
export const ADD = "CONNECTIONS ADD";
export const DELETE = "CONNECTIONS DELETE";
export const UPDATE = "CONNECTIONS UPDATE";

export interface IConnection {
    name: string;
    host: string;
    user: string;
    password: string;
    type: string;
}

export interface IConnectionState {
    isCreating: boolean;
    data: IConnection[];
}

export interface IConnectionAction {
    type: string;
    payload: IConnection;
}

export type ConnectionActionTypes = IConnectionAction;

export const isCreating = (creating: boolean) => {
    return { type: CREATE, payload: creating };
};

export const add = (connection: IConnection): IConnectionAction => {
    return { type: ADD, payload: connection };
};

export const destroy = (connection: IConnection): IConnectionAction => {
    return {type: DELETE, payload: connection};
};

export const update = (connection: IConnection) => {
    return {type: DELETE, connection};
};
