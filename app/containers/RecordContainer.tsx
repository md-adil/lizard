import * as React from "react";
import Record from "../components/Record";
import Table from "../db/Table";

interface IProps {
    table: Table;
}

interface IState {
    fields: string[];
    data: any[];
}

class RecordContainer extends React.Component<IProps, IState> {
    public state = {
        fields: [],
        data: []
    };

    public async componentDidMount() {
        const table = this.props.table;
        this.setState({
            fields: await table.fields(),
            data: await table.records()
        });
    }

    public render() {
        return (
            <Record fields={this.state.fields} data={this.state.data} />
        );
    }
}

export default RecordContainer;
