import * as Types from "../../connection/action";
import Connection from "../../../db/Connection";

interface IConnectionState {
    isCreating: boolean;
    isLoading: boolean;
    isLoaded: boolean;
    isAdding: boolean;
    active: string;
    data: Connection[];
}

const initialState: IConnectionState = {
    isLoaded: false,
    isCreating: false,
    isAdding: false,
    isLoading: false,
    active: "connections",
    data: []
};

export default (
        state = initialState, action: Types.ConnectionActionTypes,
    ): IConnectionState => {

    if (action.type === Types.LOAD) {
        return { ...state, data: action.payload, isLoaded: true };
    }

    switch (action.type) {
        case Types.CREATING:
            return { ...state, isCreating: action.payload };

        case Types.ADDING:
            return { ...state, isAdding: action.payload };

        case Types.ADD:
            return { ...state, isCreating: false, isAdding: false, data: [ ...state.data, action.payload ] };

        case Types.UPDATE:
            return state;

        case Types.LOADING:
            return { ...state, isLoading: action.payload };

        case Types.ACTIVE:
            return { ...state, active: action.payload };

        case Types.CONNECTING:
            return { ...state, data: state.data.map((connection) => {
                if (connection === action.payload) {
                    connection.isConnecting = true;
                }
                return connection;
            })};

        case Types.CONNECTED:
            return { ...state, active: action.payload.id, data: state.data.map((connection) => {
                if (connection === action.payload) {
                    connection.isConnected = true;
                    connection.isConnecting = false;
                }
                return connection;
            })};

        default:
            return state;
    }
};
