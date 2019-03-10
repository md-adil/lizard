export const CREATE = "CONECTIONS CREATE";
export const ADD = "CONNECTIONS ADD";
export const DELETE = "CONNECTIONS DELETE";
export const UPDATE = "CONNECTIONS UPDATE";

export interface IConnection {
    name: string;
    user: string;
    password: string;
    type: string;
}
