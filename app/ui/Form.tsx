import * as React from "react";

interface IProps {
    children: React.ReactNode;
}

class Form extends React.Component<IProps> {
    public render() {
        return (
            <form>
                {this.props.children}
            </form>
        );
    }
}

export default Form;
