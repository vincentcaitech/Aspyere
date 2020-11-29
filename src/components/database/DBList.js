import React from "react"
import { Redirect } from "react-router-dom";
import { pFirestore,pAuth } from "../../services/config"
import { PContext } from "../../services/context";

class DBList extends React.Component{
    constructor(){
        super();
        this.state ={
            allDBs: [],
            redirect: null,
            showCreate: false,
            name: '',
            description: '',
        }
    }


    componentDidMount(){
        // pFirestore.collection("databases").where("isViewable","==",true)

        pFirestore.collection('databases').onSnapshot((snap)=>{
            var arr = [];
            snap.forEach(doc=>{
                arr.push({...doc.data(),id: doc.id})
            })
            this.setState({allDBs: arr});
        })
        // pFirestore.collection("databases").where("isViewable","==",true).onSnapshot((snap)=>{
        //     snap.forEach(doc=>{
        //         arr.push({...doc.data(),id: doc.id});
        //     })
        //     console.log(arr);

        //     //you have to do a three more queries for the three "or" statements. make sure it is not viewable, so no duplicates occur
        //     console.log(pAuth.currentUser.uid);
            
            // pFirestore.collection('databases').where("viewers","array-contains",pAuth.currentUser.uid).get().then(docs1=>{
                
            //     docs1.forEach(doc=>{
            //         if(!doc.data().isViewable) arr.push({...doc.data(),id: doc.id});
            //     })
            //     pFirestore.collection('databases').where("editors","array-contains",pAuth.currentUser.uid).get().then(docs2=>{
                    
            //         docs2.forEach(doc=>{
            //             if(!doc.data().isViewable) arr.push({...doc.data(),id: doc.id});
            //         })
            //         pFirestore.collection('databases').where("admins","array-contains",pAuth.currentUser.uid).get().then(docs2=>{
                    
            //             docs2.forEach(doc=>{
            //                 if(!doc.data().isViewable) arr.push({...doc.data(),id: doc.id});
            //             })
            //             this.setState({allDBs: arr});
            //         })
            //     })
            // })
        // })
    }

    selectDB = (e) => {
        const id = e.target.name;
        if(!id) return this.selectDB({target: e.target.parentElement})
        console.log(id);
        this.context.setCurrentDB(id)
        this.setState({redirect: "/dbdashboard?db="+id})
    }

    renderDBs = () =>{
        var arr = [];
        this.state.allDBs.forEach(db=>{
        arr.push(<li className="db-single"><button className="db-single-button" onClick={this.selectDB} name={db.id}><h2>{db.name}</h2><p>{db.description}</p><p>Created by {db.creator}</p></button></li>)
        })
        return arr;
    }

    changeState = (e) => {
        const {name,value} = e.target;
        this.setState({[name]:value})
    } 

    createDatabase = () => {
        pFirestore.collection("databases").add({
            members: [],
            admins: [pAuth.currentUser.uid],
            memberCode: ((new Date()).getTime()*Math.random()).toString(36).replaceAll(".",""),
            isViewable: false,
            name: this.state.name,
            description: this.state.description,
            creator: pAuth.currentUser.displayName
        }).then((doc)=>{
            this.setState({redirect: "dbdashboard?db="+doc.id})
        })
    }


    render(){
        if(this.state.redirect) return <Redirect to={this.state.redirect}/>
    return(
    <div>
        <h2>All Databases</h2>
        <button onClick={()=>this.setState({showCreate: true})} className="create-button">Create a Database<div className="plus fas fa-plus-circle"></div></button>
        <ul id="db-list">{this.renderDBs()}</ul>
        {this.state.showCreate&&<div className="grayed-out-background">
            <div className="popup">
                <h3>Create a Database</h3>
                <p>Created and Administered by You</p>
                <input placeholder="Name of Database" name="name" onChange={this.changeState} style={{display: 'block'}}></input>
                <textarea id="create-db-description"placeholder="Description" name="description" onChange={this.changeState}></textarea>
                <p>You will be able to set access codes for others to access and edit your database and add items once it is created</p>
                <button className="submit-button" onClick={this.createDatabase}>Create</button><button className="cancel-button" onClick={()=>{this.setState({showCreate: false})}}>Cancel</button>
            </div>
        </div>}
    
    </div>
    )
    }
}
DBList.contextType = PContext;

export default DBList

//{this.state.allDBs.map(db=>{<li><button><div>{db.name}</div><p>{db.description}</p><p>Created by {db.creator}</p></button></li>})}