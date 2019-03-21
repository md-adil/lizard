export const ADD = "CONNECTED CONNECTION ADD";
export const DELETE = "CONNECTED CONNECTION DELETE";
import Connection from "../db/Connection";

export const add = (payload: Connection) => ({ type: ADD, payload });
