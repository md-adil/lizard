import React from "react";
import { Input } from "./Form";
import moment from "moment";
export type ChangeEvent = (value: any) => void;

interface IProps {
    children: any;
    onChange: ChangeEvent;
    type: string;
}

interface IState {
    isEditing: boolean;
    value: any;
}

class Editable extends React.Component<IProps, IState> {
    public state = {
        isEditing: false,
        value: ""
    };

    private isChanged = false;

    public handleEditing = (e: any) => {
        this.setState({
            isEditing: !this.state.isEditing,
            value: this.props.children
        });
    };

    public handleChange = (e: any) => {
        this.isChanged = true;
        this.setState({ value: e.target.value });
    };

    public handleUpdate = async () => {
        if (this.isChanged) {
            await this.props.onChange(this.state.value);
            this.isChanged = false;
        }
        this.setState({ isEditing: false });
    };

    public render() {
        const { children } = this.props;
        if (children instanceof Date) {
            return moment(children).format("LL");
        }
        if (this.state.isEditing) {
            return (
                <div>
                    <Input
                        autoFocus={true}
                        onBlur={this.handleUpdate}
                        value={this.state.value}
                        onChange={this.handleChange}
                    />
                </div>
            );
        }
        return (
            <div onDoubleClick={this.handleEditing}>{this.props.children}</div>
        );
    }
}

export default Editable;
