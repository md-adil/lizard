import * as React from "react";
import classnames from "classnames";

import "./button.scss";

interface IProps {
    children: React.ReactNode;
    onClick ?: () => void;
    isLoading: boolean;
}

class Button extends React.Component<IProps> {
    public static defaultProps = {
        isLoading: false,
    };

    public render() {
        const { children, ...props } = this.props;
        return (
            <button
                className={classnames("ui-btn", {"is-loading": this.props.isLoading})}
                {...props}
            >
                {children}
            </button>
        );
    }
}

export default Button;
