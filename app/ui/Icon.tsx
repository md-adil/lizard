import { IconProp, library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import * as React from "react";

library.add(fas);

interface IProps {
    name: IconProp;
    spin?: boolean;
}

export default (props: IProps) => <FontAwesomeIcon icon={props.name} spin={props.spin} />;
