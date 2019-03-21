import {
    ADD,
    LOAD,
    LOADING,
    CREATE,
    ConnectionActionTypes,
    IConnectionState,
    UPDATE,
    IConnection,
} from "../actions/connection";

const initialState: IConnectionState = {
    data: [],
    isCreating: false,
    isLoading: false,
};

export default (
        state = initialState, action: ConnectionActionTypes,
    ): IConnectionState => {

    if (action.type === LOAD) {
        return { ...state, data: action.payload as IConnection[] };
    }

    switch (action.type) {
        case CREATE:
            return { ...state, isCreating: action.payload as boolean };
        case ADD:
            return { ...state, data: [ ...state.data, action.payload as IConnection ] };
        case UPDATE:
            return state;
        case LOADING:
            return { ...state, isLoading: action.payload as boolean };
        default:
            return state;
    }
};
