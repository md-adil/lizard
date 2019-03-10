import * as React from "react";

interface IFormProps {
    children: React.ReactNode;
}

interface IFieldProps {
    chidren: React.ReactNode;
}

interface IControlProps {
    chidren: React.ReactNode;
}

export const Field = ({}) => (
    <div>Done</div>
);

class Form extends React.Component<IFormProps> {
    public static Field = Field;
    public render() {
        return (
            <form>
                {this.props.children}
            </form>
        );
    }
}

export default Form;
