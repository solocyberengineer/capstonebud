import {
    connection as db
} from '../config/index.js';
import {
    mail
} from '../middleware/MailingService.js';
import {
    createToken,
    verifyAToken
} from '../middleware/UserAuthentication.js';
import {
    hash,
    compare,
    compareSync
} from 'bcrypt';
import {
    code
} from '../model/index.js';
import {
    config
} from 'dotenv';
import util from 'util';
import {
    handleAuthError,
    DatabaseErrorHandling
} from '../middleware/ErrorHandling.js';

config();

const PROTO = process.env.HTTP;
const ROUNDS = +process.env.ROUNDS;
const APP_DOMAIN = process.env.APP_DOMAIN;

const dbAsync = util.promisify(db.query).bind(db);
class User {
    // admin will be able to block/unblock users even suspend(ban);
    // privs are: user, premium(can have a video on there profile), admin
    async fetchLoggedInUser(req, res){
        let token = req.headers['authorization'];

        if( !token ){
            res.status(code.UNAUTHORIZED).send({
                status: code.UNAUTHORIZED,
                msg: "Please login in"
            })
        } else {
            token = token.split(' ').at(-1);
        }

        try {
            let user = verifyAToken(token);

            const getUser = `SELECT userID, userName, userEmail, userRole, userAge, userProfile, accountCreated FROM Users WHERE userEmail = ?;`;

            db.query(getUser, [user.email], (err, result)=>{
                if(err) {
                    DatabaseErrorHandling(err, req, res);
                    return;
                };
                if( result.length <= 0 ){
                    res.status(code.UNAUTHORIZED).send({
                        status: code.UNAUTHORIZED,
                        msg: "User Account does not exist"
                    })
                    return;
                }

                let {userID, userName, userEmail, userRole, userAge, userProfile} = result[0];

                let payload = {
                    id: userID,
                    username: userName,
                    email: userEmail,
                    role: userRole,
                    age: userAge,
                    profile: userProfile
                }

                res.status(code.OK).send({
                    status: code.OK,
                    result: payload
                })
            })
        } catch(e) {
            handleAuthError(e, req, res);
            return;
        }
    }
    async fetchUser(req, res) {
        let token = req.headers['authorization'];
        let _userID = +req.params.userID;

        if( isNaN(_userID) ){
            res.status(code.NOTFOUND).send({
                status: code.NOTFOUND,
                msg: "User not found"
            })
            return;
        }

        if( !token ){
            res.status(code.UNAUTHORIZED).send({
                status: code.UNAUTHORIZED,
                msg: "Please login in"
            })
            return;
        } else {
            token = token.split(' ').at(-1);
        }

        try {
            let user = verifyAToken(token);

            const getUser = `SELECT userName, userRole, userAge, userProfile FROM Users WHERE userID = ?;`;

            db.query(getUser, [_userID], (err, result)=>{
                if(err) throw err
                res.status(code.OK).send({
                    status: code.OK,
                    result
                })
            })
        } catch(e) {
            console.log(e)
            handleAuthError(e, req, res);
        }
    }
    fetchUsers(req, res) {
        let token = req.headers['authorization'];


        if (!token) {
            res.status(code.UNAUTHORIZED).send({
                status: code.UNAUTHORIZED,
                msg: "Please Log in"
            })
            return;
        } else {
            token = token.split(' ').at(-1);
        }
        
        try {
            let user = verifyAToken(token);

            if (user.role != 'admin') {
                res.status(code.FORBIDDEN).send({
                    status: code.FORBIDDEN,
                    msg: "This is not allowed"
                })
            } else {
                const getUsers = `SELECT userID, userName, userEmail, userRole, userProfile, accountCreated FROM Users ORDER BY accountCreated DESC;`;

                db.query(getUsers, (err, result)=>{
                    if(err) throw err;
                    res.status(code.OK).send({
                        status: code.OK,
                        result
                    })
                })
            }
        } catch (e) {
            console.log(e)
            handleAuthError(e, req, res);
        }

    }
    async createUser(req, res) {
        // can only create user accounts
        // account has to be upgraded to premium
        // age restriction, 13+
        let data = req.body;
        let _token = req.headers['authorization'];

        if(_token.split(' ').at(-1) == 'null'){
            _token = null
        }

        if (!data.username || !data.email || !data.password ) {
            res.status(code.BADREQUEST).send({
                status: code.BADREQUEST,
                msg: "Invalid information provided"
            });
            return;
        }

        const emailCheck = `SELECT userEmail FROM Users WHERE userEmail = ?;`;

        let result = await dbAsync(emailCheck, [data.email]);

        if (result.length > 0) {
            res.status(code.FORBIDDEN).send({
                status: code.FORBIDDEN,
                msg: "account already exists"
            })
            return;
        }

        data.password = await hash(data.password, ROUNDS);

        let token = createToken({
            userName: data.username,
            userEmail: data.email,
            userPass: data.password.toString(),
            userAge: data.age,
            userRole: 'user'
        }, '10m');

        // token to check if the url is still valid
        let redirectUrl = `${PROTO}://${APP_DOMAIN}/verify?token=${token}`;
        if(_token){
            _token = _token.split(' ').at(-1)
            try {
                let user = verifyAToken(_token);

                console.log("user creating the account: ", user)

                if(user.role == 'admin'){
                    req.query['token'] = token
                    this.verifyUserEmail(req, res);
                    return;
                } else {
                    res.status(code.FORBIDDEN).send({
                        status: code.FORBIDDEN,
                        msg: "You not allowed to do this"
                    })
                    return;
                }
            } catch(e) {
                handleAuthError(e, req, res);
                return;
            }
        } else {
            mail(
                data.email,
                "Please confirm your email address",
                "This message is sent to you by capstonebud app.",
                `<a href='${redirectUrl}'>Verify Email</a>`
            );
        }

        res.status(code.SEEOTHER).send({
            status: code.SEEOTHER,
            msg: "email sent, please confirm this is your email address"
        })
    }
    verifyUserEmail(req, res) {
        let { token } = req.query;
        console.log(token)

        try {
            let user = verifyAToken(token);
            console.log(user);
            // put the user into the database.
            let qry = `INSERT INTO Users SET ?`;

            let payload = {
                userName: user.userName,
                userEmail: user.userEmail,
                userPass: user.userPass.toString(),
                userAge: user.userAge,
                userRole: user.userRole,
                accountCreated: (new Date()).toISOString().slice(0, 19).replace('T', " ")
            }


            db.query(qry, [payload], (err) => {
                if (err){
                    DatabaseErrorHandling(err, req, res);
                    return;
                }
                delete payload['userPass'];
                // token = createToken(payload, '7d');
                // res.json({
                //     username: user.userName,
                //     email: user.userEmail,
                //     age: user.userAge,
                //     role: user.userRole,
                //     token
                // })
                res.send(`account has been verified. You will be redirected shortly to log into your account`);

            })
            // return a session token
        } catch (e) {
            console.log(e)
            handleAuthError(e, req, res);
        }
        
    }
    async updateUser(req, res) { // PATCH
        // post the token
        let data = req.body;
        let _userID = +req.params.userID;
        let token = req.headers['authorization'];

        if( _userID == 1 ){
            res.status(code.FORBIDDEN).send({
                status: code.FORBIDDEN,
                msg: "Cannot update the app account"
            })
            return;
        }

        if( !token ){
            res.status(code.UNAUTHORIZED).send({
                status: code.UNAUTHORIZED,
                msg: "Please login in"
            })
            return;
        } else {
            token = token.split(' ').at(-1);
        }

        try {
            let user = verifyAToken(token);

            let result;

            if( user.role != 'admin' ) {
                const getUserID = `SELECT userID, userEmail, userName, userPass, userAge, userRole, userProfile FROM Users WHERE userEmail = ?;`;
    
                result = await dbAsync(getUserID, [user.email]);
                console.log(result)
            } else {
                const getUser = `SELECT userID, userEmail, userName, userPass, userAge, userRole, userProfile FROM Users WHERE userID = ?;`;
    
                result = await dbAsync(getUser, [_userID]);
                console.log(result)
            }
            if( result && result.length <= 0){
                res.status(code.NOTFOUND).send({
                    status: code.NOTFOUND,
                    msg: "User not found"
                })
                return;
            }
            const { userID, userEmail, userName, userPass, userAge, userRole, userProfile } = result[0];
            if( data.userPass ) data.userPass = await hash(data.userPass, ROUNDS);
            
            if( _userID == userID || user.role == 'admin' ){
                let tokenPayload = {
                    username: (data.userName) ? (data.userName) : userName,
                    email: userEmail,
                    age: (data.userAge) ? (data.userAge) : userAge,
                    role: (user.role == 'admin') ? data.userRole : userRole
                }
                let dbPayload = {
                    userEmail: userEmail,
                    userName: (data.userName) ? data.userName : userName,
                    userPass: (data.userPass) ? data.userPass : userPass,
                    userAge: (data.userAge) ? data.userAge : userAge,
                    userRole: (user.role == 'admin') ? data.userRole : userRole,
                    userProfile: (data.userProfile) ? data.userProfile : userProfile
                }

                let new_token = createToken(tokenPayload, '7d');

                const updateUserAccount = `UPDATE Users SET ? WHERE userID = ?`;
                db.query(updateUserAccount, [dbPayload, _userID], (err, result)=>{
                    if(err) {
                        DatabaseErrorHandling(err, req, res);
                        return;
                    }
                    res.status(code.OK).send({
                        status: code.OK,
                        msg: "Account updated successfully",
                        new_token
                    })
                    return;
                })
            } else {
                res.status(code.UNAUTHORIZED).send({
                    status: code.UNAUTHORIZED,
                    msg: "Invalid account to update"
                })
                return
            }

        } catch (e) {
            console.log(e);
            handleAuthError(e, req, res);
        }
    }
    async deleteUser(req, res) {
        // there has to be a token here, if not then how did they get here without login
        let token = req.headers['authorization'];
        let _userID = req.params.userID;
        let data = req.body;

        if( _userID == 1 ){
            res.status(code.FORBIDDEN).send({
                status: code.FORBIDDEN,
                msg: "Cannot delete the main Account"
            })
            return
        }

        if (!token) {
            res.status(code.UNAUTHORIZED).send({
                status: code.UNAUTHORIZED,
                msg: "Please Log in"
            })
            return;
        } else {
            token = token.split(' ').at(-1);
        }

        try {
            let user = verifyAToken(token);

            console.log(user)
            if( !data.password && user.role != 'admin' ) {
                res.status(code.UNAUTHORIZED).send({
                    status: code.UNAUTHORIZED,
                    msg: "Please provide password"
                })
                return;
            }

            const getUserPassword = `SELECT userID, userName, userEmail, userRole, userAge, userPass, userProfile FROM Users WHERE userEmail = ?;`;
            let result = await dbAsync(getUserPassword, [user.email]);

            if( result.length < 1 ) {
                res.status(code.NOTFOUND).send({
                    status: code.NOTFOUND,
                    msg: "Account does not exist"
                })
                return;
            }
            const { userID, userPass, userRole } = result[0];

            if(user.email == 'capstonebud@gmail.com' && userID == _userID ){
                res.status(code.FORBIDDEN).send({
                    status: code.FORBIDDEN,
                    msg: "Imagine you delete this account, this app will crash."
                })
                return;
            }

            if( _userID == userID || userRole == 'admin' ){
                let correctPass = (userRole == 'admin') ? true : compare(data.password, userPass);

                if( correctPass ){
                    const deleteUserAccount = `DELETE FROM Users WHERE userID = ?;`;

                    db.query(deleteUserAccount, [_userID], (err, result)=>{
                        if(err) {
                            DatabaseErrorHandling(err, req, res);
                            return;
                        }

                        res.status(code.OK).send({
                            status: code.OK,
                            msg: "Account deleted."
                        })
                    })

                } else {
                    res.status(code.UNAUTHORIZED).send({
                        status: code.UNAUTHORIZED,
                        msg: "Incorrect password, account not deleted"
                    })
                }
            } else {
                res.status(code.UNAUTHORIZED).send({
                    status: code.UNAUTHORIZED,
                    msg: "Invalid account to delete"
                })
            }
        } catch(e) {
            console.log(e);
            handleAuthError(e, req, res);
        }
    }
    searchUser(req, res){
        let token = req.headers['authorization'];
        let searchQuery = req.params.query;

        if( !token ){
            res.status(code.UNAUTHORIZED).send({
                status: code.UNAUTHORIZED,
                msg: "Please login in"
            })
            return;
        } else {
            token = token.split(' ').at(-1);
        }

        try {
            let user = verifyAToken(token);
            let applyRole = 'AND userRole = "user"';
            let applyEmail = ', userEmail';

            const qry = `SELECT userID, userName, userRole${ (user.role == 'admin') ? applyEmail : '' }, userProfile FROM Users WHERE userName like ? ${ (user.role != 'admin') ? applyRole : '' };`;

            db.query(qry, [searchQuery+"%"], (err, result)=>{
                if(err) throw err;
                res.status(code.OK).send({
                    status: code.OK,
                    result
                })
            })
        } catch(e) {
            handleAuthError(e, req, res);
            return;
        }
    }
    async login(req, res) {
        let data = req.body;
        // before login first check if token is valid, if its valid then redirect them away from this page, this is done on frontend

        if( !data.email || !data.password ){
            res.status(code.UNAUTHORIZED).send({
                status: code.UNAUTHORIZED,
                msg: "Invalid email or password"
            })
            return;
        }

        // check password
        const getUserPassword = `SELECT userID, userName, userEmail, userPass, userRole, userAge, userProfile FROM Users WHERE userEmail = ?;`;;
        let result = await dbAsync(getUserPassword, [data.email]);

        if( result.length > 0 ){
            const { userID, userName, userEmail, userPass, userRole, userAge, userProfile } = result[0];

            let correctPass = compareSync(data.password, userPass);

            if( correctPass ){
                let payload = {
                    username: userName,
                    email: userEmail,
                    role: userRole,
                    age: userAge
                }

                let token = createToken(payload, '7d');

                res.status(code.OK).send({
                    status: code.OK,
                    token,
                    msg: "Welcome User"
                })
                return;
            } else {
                res.status(code.UNAUTHORIZED).send({
                    status: code.UNAUTHORIZED,
                    msg: "Either password or email is incorrect"
                })
                return;
            }


        } else {
            res.status(code.UNAUTHORIZED).send({
                status: code.UNAUTHORIZED,
                msg: "Account does not exist, try signing up."
            })
        }
    }
    logout(req, res) {
        // there has to be a token here, if not then how did they get here without login
        // this will blacklist a jwt token until it expires

        // this will logout the user
    }
    upgradeUser(req, res) {
        // can only upgrade to premium user
        // premium user can have videos on their profiles
        // advanced profiles
    }
    getLoggedInDevices(req, res) {
        // gets device ip and device info
    }
    forgotPassword(req, res) {
        res.json({
            status: 200,
            msg: "email will be sent soon."
        })
        // mail()
    }

}

export {
    User
}