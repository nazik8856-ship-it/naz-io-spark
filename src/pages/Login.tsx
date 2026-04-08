import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const Login = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/signup", { replace: true });
  }, [navigate]);


  options: {
  redirectTo: `${window.location.origin}/generating`,
}
  
  return null;
};

export default Login;
