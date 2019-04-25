import * as React from "react";
import { connect } from "react-redux";
import DatabaseList from "../components/DatabaseList";
import Connection from "../db/Connection";
import Database from "../db/Database";
import Table from "../db/Table";
import * as tableAction from "../actions/table";
import { Dispatch } from "redux";

interface IProps {
    connection: Connection;
    setTable: (tables: Table[]) => void;
}
interface IState {
    databases: Database[];
}

class DatabaseListContainer extends React.Component<IProps> {
    public state = {
        databases: [],
    };

    public async componentDidMount() {
        const databases = await this.props.connection.databases();
        this.setState({ databases });
    }

    public handleSelect = async (database: Database) => {
        const tables = await database.tables();
        this.props.setTable(tables);
    }

    public render() {
        return (
            <div><DatabaseList databases={this.state.databases} onSelect={this.handleSelect} /></div>
        );
    }
}

const mapDispatchToProps = (dispatch: Dispatch) => ({
    setTable: (tables: Table[]) => dispatch(tableAction.set(tables))
});

export default connect(null, mapDispatchToProps)(DatabaseListContainer);
