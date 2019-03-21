export const ADD = "CONNECTED CONNECTION ADD";
export const DELETE = "CONNECTED CONNECTION DELETE";
import Connection from "../db/Connection";
import { IConnection } from "./connection";
import { Dispatch } from "redux";

export const add = (payload: Connection) => ({ type: ADD, payload });

export const connect = (payload: IConnection) => (dispatch: Dispatch) => {
    const activeConnection = new Connection(payload);
    dispatch({type: ADD, payload: activeConnection});
};
