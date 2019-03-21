import { combineReducers } from "redux";
import connection from "./connection";
import connectedConnection from "./connectedConnection";

export default combineReducers({ connection, connectedConnection });
