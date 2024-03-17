import { useCookies } from "vue3-cookies";

const { cookies } = useCookies();

class method {
    get = "GET";
    post = "POST";
    delete = "DELETE";
    patch = "PATCH";
}

async function sendRequest(url, method, data=null, headers=null) {
    let authToken = cookies.get('authToken');
    let requestParams = {
        method: method,
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + authToken
        }
    }

    if( headers ) requestParams.headers = headers;
    if( authToken ) requestParams.headers['Authorization'] = "Bearer " + authToken;
    if( data ) requestParams['body'] = ( requestParams.headers['Content-Type'] == 'application/json' ) ? JSON.stringify(data) : data;
    
    let result = await fetch(url, requestParams);
    console.log('result0')
    return result;
}

function getUserFromToken(){
    try {
        return JSON.parse( atob( cookies.get('authToken').split('.')[1] ) );
    } catch(e) {
        return null
    }
}

export {
    sendRequest,
    method,
    getUserFromToken
}