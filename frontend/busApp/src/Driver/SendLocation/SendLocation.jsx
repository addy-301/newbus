import {useState, useEffect, useContext, useDeferredValue, useRef} from "react"
import React from 'react';
import {
    DirectionsRenderer, DirectionsService, DistanceMatrixService,
    GoogleMap,
    MarkerF,
    TrafficLayer,
    useLoadScript
} from "@react-google-maps/api"
import "./SendLocation.css"
import { SocketContext } from "../../Context/SocketContext"
import { useParams } from "react-router-dom"
import {MAPS_KEY} from "../../Constants/keys.js";
import axios from "axios";
import {axiosConfig, SERVER_URL} from "../../Constants/config.js";

export const MemoizedDirectionsRenderer = React.memo(({ directions }) => (
    <DirectionsRenderer options={{ directions: directions }} />
));

export const MemoizedDirectionsService = React.memo(({ directionsOptions, setDirectionsResponse }) => (
    <DirectionsService options={directionsOptions} callback={(response) => {
        if (response !== null) {
            if (response.status === 'OK') {
                setDirectionsResponse(response);
            } else {
                console.log('response: ', response)
            }
        }
    }}/>
));

const MemorizedDistanceService = React.memo(({ pos, distanceOptions, setDistanceResponse }) => (
    <DistanceMatrixService options={distanceOptions} callback={(response) => {
        console.log("hi");
        setDistanceResponse(response.rows[0].elements);
    }}/>
));

export function Map()
{
    const {socket} =useContext(SocketContext)

    const [latitude,setLatitude]=useState(0);
    const [longitude,setLongitude]=useState(0);
    const [busRoute, setBusRoute]=useState();

    //To prevent react batch rendering problems
    const differedLatitude = useDeferredValue(latitude);
    const differedLongitude = useDeferredValue(longitude);

    const [waypoints, setWaypoints] = useState();
    const [directionsResponse, setDirectionsResponse] = useState(null);
    const [directionsOptions, setDirectionsOptions] = useState();
    const [distanceOptions, setDistanceOptions] = useState();
    const [stopGPS,setStopGPS]=useState(0)

    //ETA
    const [distanceResponse, setDistanceResponse] = useState();
    const [progress, setProgress] = useState();


    const {id}=useParams()

    useEffect(()=>{

        const options = {
            enableHighAccuracy: true,
            maximumAge: 0,
        };

        const error = (err) => {
            console.error(`ERROR(${err.code}): ${err.message}`);
        }

        let navID=navigator.geolocation.watchPosition((position)=>{
            setLatitude(position.coords.latitude);
            setLongitude(position.coords.longitude);
        }, error, options);
        setStopGPS(navID)

        //cleanup function when component unmounts
        return ()=>{
            if(navID)
                navigator.geolocation.clearWatch(navID)
        }

    },[latitude,longitude])

    useEffect(() => {
        axios.get(`${SERVER_URL}/api/v1/activeBus/${id}`, axiosConfig).then(
            (route) => {
                setBusRoute(route);
            }
        )
        console.log("here");
        if(sessionStorage.getItem("progress") !== null && sessionStorage.getItem("progress") !== "undefined") {
            setProgress(JSON.parse(sessionStorage.getItem("progress")));
        }
    }, [])

    useEffect(() => {
        if(!busRoute)
            return;

        const waypoints = [];
        busRoute.data.bus.route.stations.map((station) => {
            waypoints.push({"location": `${station.position[0]} ${station.position[1]}`, "stopover": true});
        });
        //console.log(waypoints);
        setWaypoints(waypoints);

        const directionsOptions = {
            destination: waypoints[waypoints.length-1].location ,
            origin: waypoints[0].location,
            waypoints: waypoints,
            travelMode: 'DRIVING',
        };
        setDirectionsOptions(directionsOptions);

        const distanceOptions = {
            origins: [`${latitude} ${longitude}`],
            //origins: [`30.2828877 78.0746451`],
            destinations: waypoints.map((waypoint) => {return waypoint.location}),
            travelMode: 'DRIVING',
            unitSystem: 0.0,
            avoidHighways: false,
            avoidTolls: false,
        }

        setDistanceOptions(distanceOptions);
    },[busRoute])

    useEffect(() => {
        //Only emitting when there is a change in position
        socket.emit(`busId`,{latitude: differedLatitude, longitude: differedLongitude, progress: progress, id})
        console.log(differedLatitude, differedLongitude, progress);

        if(distanceOptions)
            setDistanceOptions((distanceOptions) => {distanceOptions.origins = [`${latitude} ${longitude}`]
                return distanceOptions;
            });
    }, [differedLatitude, differedLongitude])

    useEffect(() => {
        if(!distanceResponse || !distanceResponse[0].distance || !distanceResponse[0].duration)
            return;
        const updateProgress = [];

        let info = Object.keys(distanceResponse);

        info.forEach((info) => {
            updateProgress.push({
                distance: distanceResponse[info].distance.text,
                eta: distanceResponse[info].duration.text,
                reached: (progress && progress[info].reached) || distanceResponse[info].distance.value < 1000?true:false
            });
        })
        //console.log(progress);

        if(updateProgress.every((entry) => {entry.reached}))
            setProgress(undefined);
        else
            setProgress(updateProgress);

        sessionStorage.setItem("progress",JSON.stringify( progress));
    }, [distanceResponse])

    //function to pause  and resume GPS
    function monitorStatus(e)
    {
        if(e.target.id === "pause")
        {
            navigator.geolocation.clearWatch(stopGPS)
            setStopGPS(0)
        }
        else
        {
            // navigator.geolocation.getCurrentPosition((position)=>{
            //     setLatitude(position.coords.latitude)
            //     setLongitude(position.coords.longitude)
            // })
            setLatitude(0)
            setLongitude(0)
        }
    }

    return (
        <>
        <div><h1 className="text-white">latitude :{differedLatitude}  longitude : {differedLongitude} </h1></div>
            <GoogleMap zoom={10} center={{lat:differedLatitude,lng:differedLongitude}} mapContainerClassName="map-container">
                { directionsOptions && <MemoizedDirectionsService directionsOptions={directionsOptions} setDirectionsResponse={setDirectionsResponse}/>}
                {directionsResponse && <>
                    <TrafficLayer/>
                    <MemoizedDirectionsRenderer directions={directionsResponse}/>

                </>}
                { distanceOptions && <MemorizedDistanceService pos={distanceOptions.origins[0]} distanceOptions={distanceOptions} setDistanceResponse={setDistanceResponse}/>}
                <MarkerF position={{lat:differedLatitude,lng:differedLongitude}} />
            </GoogleMap>
            <ul>
                {progress && progress.map((p) => {return (<li className={p.reached?"text-white":"text-red-700"}>{`* - ${p.distance} ${p.eta}`}</li>)})}
            </ul>

            <div className="flex space-x-10">
                <button className="mt-10 h-20 w-20 border-2 border-yellow-300 text-black rounded-full bg-yellow-500" onClick={monitorStatus} id="pause">
                    Stop
                </button>
                <button className="mt-10 h-20 w-20 border-2 border-green-500 text-black rounded-full bg-green-500" onClick={monitorStatus} id="start">
                    Resume
                </button>
            </div>
        </>
    )
}


function SendLocation()
{
    const {isLoaded}=useLoadScript({
        googleMapsApiKey: MAPS_KEY
    })

    if(!isLoaded) return <h1 className="text-white">wait plz</h1>
    else
    return (
    <>
        <div>
            {/* <TrackVechicle/> */}
        </div>
        <Map className="mt-10"/>
    </>
    )
}

export default SendLocation




