import { createStore, applyMiddleware } from "redux";
import thunk from "redux-thunk";
import rootReducers from "./reducers";

export type AppState = ReturnType<typeof rootReducers>;

export default createStore(
    rootReducers,
    applyMiddleware(thunk)
);
