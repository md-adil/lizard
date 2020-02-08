import * as React from "react";
import store from "../store";
import * as contentAction from "../store/content/action";
import Database from "../db/Database";
import Spinner from "../ui/Spinner";
import TableListContainer from "./TableListContainer";

interface IProps {
    database: Database;
}

interface IState {
    isLoading: boolean;
}

class DatabaseContainer extends React.Component<IProps, IState> {
    public state = {
        isLoading: false
    };

    public handleShowTables = async (e: any) => {
        this.setState({ isLoading: true });
        const database = this.props.database;
        const tables = await database.tables();
        this.setState({ isLoading: false });
    };

    public render() {
        return (
            <div onDoubleClick={this.handleShowTables}>
                {this.state.isLoading && <Spinner />}
                {this.props.database.name}
            </div>
        );
    }
}

export default DatabaseContainer;
