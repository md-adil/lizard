import * as React from "react";
import { connect } from "react-redux";
import ConnectionComponent from "../components/Connection";
import { Dispatch } from "redux";
import Connection from "../db/Connection";
import Table from "../db/Table";
import * as tableAction from "../store/table/action";

interface IProps {
    connection: Connection;
    tables: Table[];
    dispatch: Dispatch;
}

interface IState {
    activeTab: string;
}

class ConnectionContainer extends React.Component<IProps, IState> {
    public handleConnect = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
    }

    public handleTabChange = (key: string) => {
        this.setState({activeTab: key});
    }

    public handleSelectTable = (table: Table, e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        this.props.dispatch(tableAction.connect(table));
        this.setState({activeTab: table.name});
    }

    public render() {
        return (
            <ConnectionComponent
                onSelectTable={this.handleSelectTable}
                handleTabChagne={this.handleTabChange}
                connection={this.props.connection}
            />
        );
    }
}

const mapDispatch = (dispatch: Dispatch) => ({ dispatch });
// const mapStateToProps = ({ table }: AppState) => ({
//     tables: table.data
// });

export default connect(null, mapDispatch)(ConnectionContainer);
